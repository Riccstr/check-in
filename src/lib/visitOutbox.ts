import { v4 as uuidv4 } from "uuid";

// ─── Visit event outbox ────────────────────────────────────────────────────
//
// An append-only queue of state-transition events. Every visit lifecycle
// transition (arrived / completed / skipped / off-route / edit) is expressed
// as ONE event appended here. A single worker (syncEngine) drains it in order
// and is fully idempotent: every event carries the same `clientId`, and the
// server upserts on it, so replaying an event can never create a duplicate.
//
// This file defines the event shape and a thin enqueue helper only. The IDB
// store accessors live in offlineDb.ts (consistent with the rest of the app),
// and the drain/apply logic lives in syncEngine.ts.

export type VisitEventType =
  | "arrived"      // check-in: drives the admin live "in progress" status
  | "completed"    // check-out: the single born-complete visits row (status 'visited')
  | "skipped"      // stop marked skipped
  | "off_route"    // off-route order: born-complete visits row (status 'off_route')
  | "edit";        // post-checkout correction to an already-completed visit

export interface VisitEventOrder {
  order_number: string | null;
  order_quantity: number | null;
  order_amount: number | null;
}

export interface VisitEvent {
  // Idempotency key. Generated once when a visit is started (or when an
  // off-route order is begun) and reused unchanged for every event that
  // belongs to the same visit — including a later `edit`.
  clientId: string;

  // Monotonic per-event id so the outbox store has a stable keyPath and two
  // events for the same clientId (e.g. arrived + completed) never collide.
  eventId: string;

  type: VisitEventType;

  // Identity of the visit this event belongs to.
  repId: string;
  customerId: string;
  visitDate: string;            // YYYY-MM-DD

  // For scheduled visits only — lets the worker link the visits row back to
  // the originating schedule_items row. Null for ad-hoc and off-route.
  scheduleItemId: string | null;

  // Wall-clock SAST times, matching the visits.arrival_time / leaving_time
  // convention. Present depending on event type:
  //   arrived   → arrivalTime set, leavingTime null
  //   completed → both set
  //   skipped   → both null
  //   off_route → both null
  //   edit      → whichever the correction changes (may be null)
  arrivalTime: string | null;
  leavingTime: string | null;
  durationMinutes: number | null;

  notes: string | null;
  order: VisitEventOrder;

  // The terminal status this event implies on the visits row.
  //   completed → 'visited'
  //   skipped   → 'skipped'
  //   off_route → 'off_route'
  //   arrived   → null (no visits row written yet)
  //   edit      → null (status unchanged by an edit)
  status: "visited" | "skipped" | "off_route" | null;

  // Photo captured for this visit, base64 (data URL or raw). Only ever set on
  // a `completed` event. The worker uploads it and does not mark the event
  // synced until both the row and (if present) the photo have landed.
  photoBase64: string | null;

  // Number of times a photo-only re-upload has been re-queued for this event.
  // Capped in syncEngine so a permanently-broken blob can't retry forever.
  photoRetries?: number;

  createdAtLocal: string;       // ISO, for stable ordering of the drain
  syncStatus: "pending" | "synced" | "error";
  lastSyncAttempt: string | null;
  errorMessage: string | null;
}

export function newClientId(): string {
  return uuidv4();
}

// Build a fully-formed event with sensible defaults. Callers (visitMachine)
// override only the fields relevant to the event type.
export function makeEvent(
  partial: Partial<VisitEvent> &
    Pick<VisitEvent, "clientId" | "type" | "repId" | "customerId" | "visitDate">
): VisitEvent {
  return {
    eventId: uuidv4(),
    scheduleItemId: null,
    arrivalTime: null,
    leavingTime: null,
    durationMinutes: null,
    notes: null,
    order: { order_number: null, order_quantity: null, order_amount: null },
    status: null,
    photoBase64: null,
    photoRetries: 0,
    createdAtLocal: new Date().toISOString(),
    syncStatus: "pending",
    lastSyncAttempt: null,
    errorMessage: null,
    ...partial,
  };
}