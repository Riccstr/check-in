import {
  getActiveVisit,
  saveActiveVisit,
  clearActiveVisit,
  enqueueVisitEvent,
  type ActiveVisit,
} from "./offlineDb";
import { makeEvent, newClientId } from "./visitOutbox";
import { parseAmount, calcDuration, nowTime } from "@/components/schedule/ScheduleHelpers";

// ─── Visit state machine ────────────────────────────────────────────────────
//
// The single orchestration layer for the entire visit lifecycle — scheduled,
// ad-hoc, and off-route. Pure logic: no React, no direct Supabase calls. It
// owns the in-progress ActiveVisit record (device truth) and appends events to
// the outbox (which syncEngine drains idempotently).
//
// Invariants enforced HERE and nowhere else:
//   1. At most one open visit at a time (scheduled or ad-hoc).
//   2. A visit can never be checked out with a non-positive duration.
//   3. A visits row is born complete at checkout — never at arrival.
//   4. clientId is generated once at check-in and reused for every event of
//      that visit, including a later edit, as the idempotency key.

// ── Result types so callers can react without throwing ──

export type StartResult =
  | { ok: true; active: ActiveVisit }
  | { ok: false; reason: "already_open"; openCustomerName: string | null };

export type CheckoutResult =
  | { ok: true; leavingTime: string; durationMinutes: number }
  | { ok: false; reason: "zero_duration" }
  | { ok: false; reason: "no_active" };

export interface DraftFields {
  notes?: string;
  orderNumber?: string;
  orderQty?: string;
  orderAmount?: string;
  photoBase64?: string | null;
}

// ── Shared helpers ──

function orderFromStrings(
  orderNumber: string,
  orderQty: string,
  orderAmount: string
) {
  return {
    order_number: orderNumber || null,
    order_quantity: orderQty !== "" ? Number(orderQty) : null,
    order_amount: parseAmount(orderAmount),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// START (check in) — scheduled or ad-hoc
// ═══════════════════════════════════════════════════════════════════════════

export async function startVisit(params: {
  kind: "scheduled" | "adhoc";
  repId: string;
  customerId: string;
  customerName: string | null;
  visitDate: string;
  scheduleItemId: string | null;
}): Promise<StartResult> {
  // Invariant 1 — one open visit. If an ActiveVisit already exists for a
  // DIFFERENT customer, block. If it's the SAME stop (double-tap / resume),
  // treat as idempotent and return the existing record.
  const existing = await getActiveVisit();
  if (existing) {
    const sameStop =
      existing.customerId === params.customerId &&
      existing.visitDate === params.visitDate;
    if (sameStop) {
      return { ok: true, active: existing };
    }
    return {
      ok: false,
      reason: "already_open",
      openCustomerName: existing.customerName,
    };
  }

  const clientId = newClientId();
  const arrivalTime = nowTime();

  const active: ActiveVisit = {
    clientId,
    kind: params.kind,
    scheduleItemId: params.scheduleItemId,
    repId: params.repId,
    customerId: params.customerId,
    customerName: params.customerName,
    visitDate: params.visitDate,
    arrivalTime,
    notes: "",
    orderNumber: "",
    orderQty: "",
    orderAmount: "",
    photoBase64: null,
    updatedAt: new Date().toISOString(),
  };

  await saveActiveVisit(active);

  // Emit the 'arrived' event — drives the admin live "in progress" status for
  // BOTH scheduled and ad-hoc visits. Off-route never calls startVisit, so it
  // never emits 'arrived' (correct — it never shows as in progress).
  await enqueueVisitEvent(
    makeEvent({
      clientId,
      type: "arrived",
      repId: params.repId,
      customerId: params.customerId,
      visitDate: params.visitDate,
      scheduleItemId: params.scheduleItemId,
      arrivalTime,
    })
  );

  return { ok: true, active };
}

// ═══════════════════════════════════════════════════════════════════════════
// UPDATE DRAFT — notes / order / photo while in progress
// ═══════════════════════════════════════════════════════════════════════════

// Merges field changes into the ActiveVisit record. No event is emitted for a
// draft change — only terminal transitions (checkout/skip) produce the visit.
export async function updateDraft(fields: DraftFields): Promise<ActiveVisit | null> {
  const active = await getActiveVisit();
  if (!active) return null;

  const next: ActiveVisit = {
    ...active,
    notes: fields.notes ?? active.notes,
    orderNumber: fields.orderNumber ?? active.orderNumber,
    orderQty: fields.orderQty ?? active.orderQty,
    orderAmount: fields.orderAmount ?? active.orderAmount,
    photoBase64:
      fields.photoBase64 === undefined ? active.photoBase64 : fields.photoBase64,
    updatedAt: new Date().toISOString(),
  };
  await saveActiveVisit(next);
  return next;
}

// ═══════════════════════════════════════════════════════════════════════════
// CHECK OUT — the born-complete transition
// ═══════════════════════════════════════════════════════════════════════════

export async function checkOut(): Promise<CheckoutResult> {
  const active = await getActiveVisit();
  if (!active) return { ok: false, reason: "no_active" };

  const leavingTime = nowTime();
  const duration = calcDuration(active.arrivalTime, leavingTime);

  // Invariant 2 — never write a non-positive-duration visit. This is the
  // structural replacement for the old cameraCooldown/ghost-tap guards: a
  // stray tap that fires checkout the same minute as arrival is rejected here.
  if (duration <= 0) return { ok: false, reason: "zero_duration" };

  const order = orderFromStrings(active.orderNumber, active.orderQty, active.orderAmount);

  // Single 'completed' event → one born-complete visits row (status 'visited').
  await enqueueVisitEvent(
    makeEvent({
      clientId: active.clientId,
      type: "completed",
      repId: active.repId,
      customerId: active.customerId,
      customerName: active.customerName,
      visitDate: active.visitDate,
      scheduleItemId: active.scheduleItemId,
      arrivalTime: active.arrivalTime,
      leavingTime,
      durationMinutes: duration,
      notes: active.notes || null,
      order,
      status: "visited",
      photoBase64: active.photoBase64,
    })
  );

  await clearActiveVisit();
  return { ok: true, leavingTime, durationMinutes: duration };
}

// ═══════════════════════════════════════════════════════════════════════════
// SKIP — from pending or in-progress
// ═══════════════════════════════════════════════════════════════════════════

export async function skip(params: {
  repId: string;
  customerId: string;
  visitDate: string;
  scheduleItemId: string | null;
  reason: string;
  customerName?: string | null;
}): Promise<void> {
  // If the skip is for the currently-open visit, retire it. clientId reuse
  // keeps the arrived+skipped pair on the same idempotency key.
  const active = await getActiveVisit();
  const isActiveStop =
    active &&
    active.customerId === params.customerId &&
    active.visitDate === params.visitDate;

  const clientId = isActiveStop ? active!.clientId : newClientId();

  await enqueueVisitEvent(
    makeEvent({
      clientId,
      type: "skipped",
      repId: params.repId,
      customerId: params.customerId,
      customerName: params.customerName ?? (isActiveStop ? active!.customerName : null),
      visitDate: params.visitDate,
      scheduleItemId: params.scheduleItemId,
      notes: params.reason,
      status: "skipped",
    })
  );

  if (isActiveStop) await clearActiveVisit();
}

// ═══════════════════════════════════════════════════════════════════════════
// OFF-ROUTE — born-complete order, no check-in, no photo, never "in progress"
// ═══════════════════════════════════════════════════════════════════════════

export async function logOffRoute(params: {
  repId: string;
  customerId: string;
  visitDate: string;
  orderNumber: string;
  orderQty: string;
  orderAmount: string;
  notes: string;
  customerName?: string | null;
}): Promise<void> {
  const order = orderFromStrings(params.orderNumber, params.orderQty, params.orderAmount);

  await enqueueVisitEvent(
    makeEvent({
      clientId: newClientId(),
      type: "off_route",
      repId: params.repId,
      customerId: params.customerId,
      customerName: params.customerName ?? null,
      visitDate: params.visitDate,
      scheduleItemId: null,
      notes: params.notes || null,
      order,
      status: "off_route",
    })
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// EDIT — post-checkout correction to an already-completed visit
// ═══════════════════════════════════════════════════════════════════════════

// The visit row already exists on the server. An 'edit' event carries the
// corrected fields; syncEngine applies them to the row matched by clientId.
// arrivalTime/leavingTime are optional — only sent when the edit changes them.
export async function editCompleted(params: {
  clientId: string;
  repId: string;
  customerId: string;
  visitDate: string;
  arrivalTime: string | null;
  leavingTime: string | null;
  orderNumber: string;
  orderQty: string;
  orderAmount: string;
  notes: string | null;
}): Promise<void> {
  const order = orderFromStrings(params.orderNumber, params.orderQty, params.orderAmount);
  const duration =
    params.arrivalTime && params.leavingTime
      ? calcDuration(params.arrivalTime, params.leavingTime)
      : null;

  await enqueueVisitEvent(
    makeEvent({
      clientId: params.clientId,
      type: "edit",
      repId: params.repId,
      customerId: params.customerId,
      visitDate: params.visitDate,
      arrivalTime: params.arrivalTime,
      leavingTime: params.leavingTime,
      durationMinutes: duration,
      notes: params.notes,
      order,
    })
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// SUPERSEDE — silently retire a ghost visit (device found no matching item
// on today's board during an authoritative reconcile). Never shown to the
// rep; the visits row + sync_errors row are the only trace, both surfaced to
// admins only.
// ═══════════════════════════════════════════════════════════════════════════

export async function supersedeGhostVisit(active: ActiveVisit): Promise<void> {
  const order = orderFromStrings(active.orderNumber, active.orderQty, active.orderAmount);

  await enqueueVisitEvent(
    makeEvent({
      clientId: active.clientId,
      type: "superseded",
      repId: active.repId,
      customerId: active.customerId,
      customerName: active.customerName,
      visitDate: active.visitDate,
      scheduleItemId: null, // no valid target to link — that's the whole point
      arrivalTime: active.arrivalTime,
      notes: active.notes || null,
      order,
      status: "superseded",
    })
  );

  await clearActiveVisit();
}