import { supabase } from "@/integrations/supabase/client";
import {
  getPendingVisitEvents,
  updateVisitEventStatus,
  removeSyncedVisitEvents,
  enqueueVisitEvent,
} from "./offlineDb";
import type { VisitEvent } from "./visitOutbox";
import { base64ToBlob } from "./imageCompressor";

// ─── Sync engine ────────────────────────────────────────────────────────────
//
// Drains the visit_outbox in order and applies each event to the server. Every
// operation is idempotent on clientId, so re-running the drain (retry, app
// resume, concurrent trigger) can never create a duplicate.
//
// Event → server mapping:
//   arrived    → INSERT visit_events row (event_type 'arrived')  [live status]
//   completed  → UPSERT visits row (status 'visited') on client_generated_id,
//                link schedule_item, upload photo,
//                INSERT visit_events row (event_type 'completed')
//   skipped    → UPSERT visits row (status 'skipped'),
//                link schedule_item, INSERT visit_events ('skipped')
//   off_route  → UPSERT visits row (status 'off_route'). No schedule link,
//                no visit_events (off-route never shows as live progress).
//   edit       → UPDATE existing visits row matched by client_generated_id.
//
// A single navigator.locks guard serialises the whole drain so concurrent
// triggers (online event, resumeCoordinator, etc.) can't interleave.

// ── visit_events (live status log) ──

async function insertVisitEvent(
  ev: VisitEvent,
  eventType: "arrived" | "completed" | "skipped",
  eventTime: string | null
): Promise<void> {
  // Idempotent: UNIQUE(client_id, event_type) means a replayed event no-ops.
  const { error } = await (supabase as any)
    .from("visit_events")
    .upsert(
      {
        client_id: ev.clientId,
        rep_id: ev.repId,
        customer_id: ev.customerId,
        visit_date: ev.visitDate,
        event_type: eventType,
        event_time: eventTime ?? "00:00:00",
      },
      { onConflict: "client_id,event_type" }
    );
  if (error) throw error;
}

// ── schedule_items linkage (scheduled visits only) ──

async function linkScheduleItem(ev: VisitEvent, visitId: string): Promise<void> {
  // Prefer the exact schedule_item id the visit came from; fall back to a
  // customer+date lookup if it wasn't carried (older event / regeneration).
  try {
    let scheduleItemId = ev.scheduleItemId;

    if (!scheduleItemId) {
      const { data: schedule } = await supabase
        .from("daily_schedules")
        .select("id")
        .eq("rep_id", ev.repId)
        .eq("schedule_date", ev.visitDate)
        .maybeSingle();
      if (!schedule?.id) return;

      const { data: si } = await supabase
        .from("schedule_items")
        .select("id")
        .eq("schedule_id", schedule.id)
        .eq("customer_id", ev.customerId)
        .order("sort_order", { ascending: true })
        .limit(1)
        .maybeSingle();
      scheduleItemId = si?.id ?? null;
    }

    if (!scheduleItemId) return;

    await supabase
      .from("schedule_items")
      .update({
        visit_id: visitId,
        arrival_time: ev.arrivalTime,
        leaving_time: ev.leavingTime,
        duration_minutes: ev.durationMinutes,
        notes: ev.notes,
        status: ev.status ?? "visited",
      })
      .eq("id", scheduleItemId);
  } catch (err) {
    console.warn("[Sync] schedule_item link failed:", err);
    // Non-fatal: the visits row is the source of truth; DailySchedule's
    // background repair can re-link later.
  }
}

// ── photo upload for a completed visit ──

async function uploadPhoto(ev: VisitEvent, visitId: string): Promise<boolean> {
  if (!ev.photoBase64) return true; // nothing to upload = success
  try {
    const blob = base64ToBlob(ev.photoBase64);
    const path = `${ev.repId}/${visitId}.jpg`;
    const { error } = await supabase.storage
      .from("visit-photos")
      .upload(path, blob, { contentType: "image/jpeg", upsert: true });
    if (error) {
      console.warn("[Sync] photo upload failed:", error.message);
      return false;
    }
    const { data: urlData } = supabase.storage.from("visit-photos").getPublicUrl(path);
    if (urlData?.publicUrl) {
      await supabase.from("visits").update({ photo_url: urlData.publicUrl } as any).eq("id", visitId);
    }
    return true;
  } catch (err) {
    console.warn("[Sync] photo upload exception:", err);
    return false;
  }
}

// ── the born-complete visit upsert (completed / skipped / off_route) ──

async function upsertVisit(ev: VisitEvent): Promise<string | null> {
  const payload: any = {
    rep_id: ev.repId,
    customer_id: ev.customerId,
    visit_date: ev.visitDate,
    arrival_time: ev.arrivalTime,
    leaving_time: ev.leavingTime,
    duration_minutes: ev.durationMinutes,
    notes: ev.notes,
    status: ev.status,
    order_number: ev.order.order_number,
    order_quantity: ev.order.order_quantity,
    order_amount: ev.order.order_amount,
    client_generated_id: ev.clientId,
  };

  const { data, error } = await supabase
    .from("visits")
    .upsert(payload, { onConflict: "client_generated_id" })
    .select("id")
    .maybeSingle();

  if (error) throw error;
  return data?.id ?? null;
}

// Atomic replacement for the previous upsertVisit() + linkScheduleItem()
// two-step sequence used by "completed" and "skipped". Those were two
// separate awaited network calls with no shared transaction — there was a
// real window where the visits row existed but schedule_items.visit_id
// hadn't been set yet, during which any fetch (rep's own unscheduled-visits
// query, admin dashboard, etc.) would correctly see the visit as unlinked
// and briefly show it as an unscheduled duplicate. This single RPC performs
// both writes in one Postgres transaction, closing that window entirely.
async function completeVisitAndLinkScheduleItem(ev: VisitEvent): Promise<string | null> {
  const { data, error } = await (supabase.rpc as any)("complete_visit_and_link_schedule_item", {
    p_client_id: ev.clientId,
    p_rep_id: ev.repId,
    p_customer_id: ev.customerId,
    p_visit_date: ev.visitDate,
    p_arrival_time: ev.arrivalTime,
    p_leaving_time: ev.leavingTime,
    p_duration_minutes: ev.durationMinutes,
    p_notes: ev.notes,
    p_status: ev.status,
    p_order_number: ev.order.order_number,
    p_order_quantity: ev.order.order_quantity,
    p_order_amount: ev.order.order_amount,
    p_schedule_item_id: ev.scheduleItemId ?? null,
  });
  if (error) throw error;
  return (data as string | null) ?? null;
}

// ── apply a single event; throws on hard failure so the caller marks it error ──

async function applyEvent(ev: VisitEvent): Promise<void> {
  switch (ev.type) {
    case "arrived": {
      await insertVisitEvent(ev, "arrived", ev.arrivalTime);
      return;
    }

    case "completed": {
      const visitId = await completeVisitAndLinkScheduleItem(ev);
      if (visitId) {
        const photoOk = await uploadPhoto(ev, visitId);
        // Live-status event. If the photo failed, we still record completion —
        // the row exists; photo re-queues below.
        await insertVisitEvent(ev, "completed", ev.leavingTime);
        if (!photoOk && ev.photoBase64) {
          const retries = ev.photoRetries ?? 0;
          if (retries < 5) {
            // Re-queue a photo-only retry as a fresh 'completed' event carrying
            // the photo. Its visit upsert no-ops (same clientId), then the
            // upload retries. Capped at 5 attempts so a permanently-broken
            // blob can't retry forever.
            await enqueueVisitEvent({
              ...ev,
              eventId: `${ev.clientId}-photoretry-${retries + 1}`,
              photoRetries: retries + 1,
              syncStatus: "pending",
              lastSyncAttempt: null,
              errorMessage: null,
            });
          } else {
            console.warn(`[Sync] photo upload gave up after ${retries} attempts for visit clientId=${ev.clientId}`);
          }
        }
      }
      return;
    }

    case "skipped": {
      const visitId = await completeVisitAndLinkScheduleItem(ev);
      await insertVisitEvent(ev, "skipped", ev.leavingTime);
      return;
    }

    case "off_route": {
      // Born-complete order. No schedule link, no visit_events row.
      await upsertVisit(ev);
      return;
    }

    case "superseded": {
      // Admin-facing error record only — mirrors off_route: a status-only
      // visits row, no visit_events row (this was never a real completed
      // visit). AdminDashboard cross-references visits.status === 'superseded'
      // directly to close out the original 'arrived' event's live-status
      // effect, so no new visit_events row or event type is needed there.
      const visitId = await upsertVisit(ev);
      if (visitId) {
        const { error } = await (supabase as any).from("sync_errors").insert({
          rep_id: ev.repId,
          error_type: "visit_superseded",
          message: "Visit superseded due to error",
          context: {
            customer_id: ev.customerId,
            visit_date: ev.visitDate,
            client_id: ev.clientId,
          },
        });
        if (error) console.warn("[Sync] sync_errors insert failed for superseded visit:", error.message);
      }
      return;
    }

    case "edit": {
      // Correct an existing row matched by clientId. Only send fields present.
      const patch: any = {
        notes: ev.notes,
        order_number: ev.order.order_number,
        order_quantity: ev.order.order_quantity,
        order_amount: ev.order.order_amount,
      };
      if (ev.arrivalTime) patch.arrival_time = ev.arrivalTime;
      if (ev.leavingTime) patch.leaving_time = ev.leavingTime;
      if (ev.durationMinutes != null) patch.duration_minutes = ev.durationMinutes;

      const { error } = await supabase
        .from("visits")
        .update(patch)
        .eq("client_generated_id", ev.clientId);
      if (error) throw error;

      // Mirror time/notes onto the linked schedule_item if this was scheduled.
      if (ev.scheduleItemId || ev.customerId) {
        await linkScheduleItemForEdit(ev);
      }
      return;
    }
  }
}

// Edit-specific schedule_item mirror — only touches fields the edit changed.
async function linkScheduleItemForEdit(ev: VisitEvent): Promise<void> {
  try {
    const { data: schedule } = await supabase
      .from("daily_schedules")
      .select("id")
      .eq("rep_id", ev.repId)
      .eq("schedule_date", ev.visitDate)
      .maybeSingle();
    if (!schedule?.id) return;

    const { data: si } = await supabase
      .from("schedule_items")
      .select("id")
      .eq("schedule_id", schedule.id)
      .eq("customer_id", ev.customerId)
      .maybeSingle();
    if (!si?.id) return;

    const patch: any = { notes: ev.notes };
    if (ev.arrivalTime) patch.arrival_time = ev.arrivalTime;
    if (ev.leavingTime) patch.leaving_time = ev.leavingTime;
    if (ev.durationMinutes != null) patch.duration_minutes = ev.durationMinutes;

    await supabase.from("schedule_items").update(patch).eq("id", si.id);
  } catch (err) {
    console.warn("[Sync] edit schedule_item mirror failed:", err);
  }
}

// ── the drain ──

export async function syncVisitEvents(): Promise<{ synced: number; errors: number }> {
  return navigator.locks.request("sync-visit-events", async () => {
    let synced = 0;
    let errors = 0;

    try {
      const pending = await getPendingVisitEvents();
      // Order matters: arrived before completed before edit, for the same
      // visit. createdAtLocal preserves that ordering since events are emitted
      // in lifecycle order.
      pending.sort((a, b) => a.createdAtLocal.localeCompare(b.createdAtLocal));

      for (const ev of pending) {
        try {
          await applyEvent(ev);
          await updateVisitEventStatus(ev.eventId, "synced");
          synced++;
        } catch (err: any) {
          console.error("[Sync] event failed:", ev.type, err?.code, err?.message);
          await updateVisitEventStatus(ev.eventId, "error", err?.message || "Unknown sync error");
          errors++;
        }
      }

      if (synced > 0) await removeSyncedVisitEvents();
    } catch (err: any) {
      console.error("[Sync] drain error:", err);
    }

    return { synced, errors };
  });
}

// ── auto-sync wiring (same name/signature/triggers as before) ──
// AppLayout imports setupAutoSync — keep the export identical so that file
// doesn't need to change.

export function setupAutoSync(onSyncComplete?: () => void) {
  const doSync = async () => {
    if (!navigator.onLine) return;
    const result = await syncVisitEvents();
    if (result.synced > 0 || result.errors > 0) {
      onSyncComplete?.();
    }
  };

  const handleOnline = () => { setTimeout(doSync, 1500); };

  window.addEventListener("online", handleOnline);
  if (navigator.onLine) setTimeout(doSync, 2000);

  return () => {
    window.removeEventListener("online", handleOnline);
  };
}