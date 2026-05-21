import { supabase } from "@/integrations/supabase/client";
import {
  getPendingVisits,
  updateVisitSyncStatus,
  removeSyncedVisits,
  getPendingScheduleItemUpdates,
  updateScheduleItemUpdateSyncStatus,
  removeSyncedScheduleItemUpdates,
  savePendingPhoto,
} from "./offlineDb";
import { toast } from "sonner";
import { base64ToBlob } from "./imageCompressor";

async function syncPendingScheduleItemUpdates(): Promise<{ synced: number; errors: number }> {
  const pending = await getPendingScheduleItemUpdates();
  if (pending.length === 0) return { synced: 0, errors: 0 };

  pending.sort((a, b) => a.created_at_local.localeCompare(b.created_at_local));

  let synced = 0;
  let errors = 0;

  for (const update of pending) {
    try {
      const { error } = await supabase
        .from("schedule_items")
        .update({
          arrival_time: update.payload.arrival_time,
          leaving_time: update.payload.leaving_time,
          duration_minutes: update.payload.duration_minutes,
          notes: update.payload.notes,
          status: update.payload.status,
        })
        .eq("id", update.schedule_item_id);

      if (error) {
        await updateScheduleItemUpdateSyncStatus(update.schedule_item_id, "error", error.message);
        errors++;
      } else {
        // If this update carries a visitId it means the visit row was already INSERTed at
        // arrival (online) and we now need to PATCH it with the checkout fields.
        if (update.visitId) {
          try {
            await supabase.from("visits").update({
              leaving_time: update.payload.leaving_time,
              duration_minutes: update.payload.duration_minutes,
              notes: update.payload.notes,
              status: update.payload.status,
              ...(update.payload.order_number  !== undefined ? { order_number:  update.payload.order_number  } : {}),
              ...(update.payload.order_quantity !== undefined ? { order_quantity: update.payload.order_quantity } : {}),
              ...(update.payload.order_amount  !== undefined ? { order_amount:  update.payload.order_amount  } : {}),
            } as any).eq("id", update.visitId);
          } catch (patchErr) {
            console.warn("[Sync] Failed to patch visit on reconnect:", patchErr);
          }
        }
        await updateScheduleItemUpdateSyncStatus(update.schedule_item_id, "synced");
        synced++;
      }
    } catch (err: any) {
      await updateScheduleItemUpdateSyncStatus(
        update.schedule_item_id,
        "error",
        err?.message || "Unknown schedule sync error"
      );
      errors++;
    }
  }

  if (synced > 0) {
    await removeSyncedScheduleItemUpdates();
  }

  return { synced, errors };
}

async function linkVisitToScheduleItem(visitId: string, payload: any): Promise<void> {
  try {
    const { data: schedule } = await supabase
      .from("daily_schedules")
      .select("id")
      .eq("rep_id", payload.rep_id)
      .eq("schedule_date", payload.visit_date)
      .maybeSingle();

    if (!schedule?.id) return;

    const { data: scheduleItem } = await supabase
      .from("schedule_items")
      .select("id")
      .eq("schedule_id", schedule.id)
      .eq("customer_id", payload.customer_id)
      .order("sort_order", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!scheduleItem?.id) return;

    await supabase
      .from("schedule_items")
      .update({
        visit_id: visitId,
        arrival_time: payload.arrival_time,
        leaving_time: payload.leaving_time,
        duration_minutes: payload.duration_minutes,
        notes: payload.notes,
        status: payload.status || "visited",
      })
      .eq("id", scheduleItem.id);
  } catch (err) {
    console.warn("[Sync] Failed to link visit to schedule item:", err);
  }
}

export async function syncPendingVisits(): Promise<{ synced: number; errors: number }> {
  return navigator.locks.request('sync-visits', async () => {
    let synced = 0;
    let errors = 0;
    let syncedVisitsCount = 0;

    try {
      const pending = await getPendingVisits();
      pending.sort((a, b) => a.created_at_local.localeCompare(b.created_at_local));

      for (const visit of pending) {
        try {
          const payload = visit.payload as any;

          // Check if already exists by client_generated_id (idempotency).
          // Guard against the column not existing in the DB — if the query errors
          // we skip this check and fall through to the duplicate check instead.
          const { data: existing, error: existingErr } = await supabase
            .from("visits")
            .select("id")
            .eq("client_generated_id", visit.client_generated_id)
            .maybeSingle();

          if (!existingErr && existing) {
            await updateVisitSyncStatus(visit.client_generated_id, "synced");
            synced++;
            syncedVisitsCount++;
            continue;
          }

          // Duplicate check: same rep + customer + date + times
          const { data: recentDupe } = await supabase
            .from("visits")
            .select("id")
            .eq("rep_id", payload.rep_id)
            .eq("customer_id", payload.customer_id)
            .eq("visit_date", payload.visit_date)
            .eq("arrival_time", payload.arrival_time)
            .eq("leaving_time", payload.leaving_time)
            .maybeSingle();

          if (recentDupe) {
            await updateVisitSyncStatus(visit.client_generated_id, "synced");
            synced++;
            syncedVisitsCount++;
            continue;
          }

          // Strip client_generated_id from the insert payload — the visits table
          // may not have this column. Idempotency is handled by the checks above.
          const { client_generated_id: _cgid, ...insertPayload } = payload;
          console.log("[Sync] inserting offline visit:", JSON.stringify(insertPayload));

          const { data: insertedVisit, error } = await supabase
            .from("visits")
            .insert(insertPayload)
            .select("id")
            .maybeSingle();

          if (error) {
            console.error("[Sync] visit insert error:", error.code, error.message, error.details, error.hint);
            await updateVisitSyncStatus(visit.client_generated_id, "error", error.message);
            errors++;
          } else {
            await updateVisitSyncStatus(visit.client_generated_id, "synced");
            synced++;
            syncedVisitsCount++;

            if (insertedVisit?.id) {
              await linkVisitToScheduleItem(insertedVisit.id, payload);

              // Upload photo if stored offline
              if (visit.photo_base64) {
                try {
                  const blob = base64ToBlob(visit.photo_base64);
                  const path = `${payload.rep_id}/${insertedVisit.id}.jpg`;
                  const { error: uploadErr } = await supabase.storage
                    .from("visit-photos")
                    .upload(path, blob, { contentType: "image/jpeg", upsert: true });
                  if (!uploadErr) {
                    const { data: urlData } = supabase.storage.from("visit-photos").getPublicUrl(path);
                    if (urlData?.publicUrl) {
                      await supabase.from("visits").update({ photo_url: urlData.publicUrl } as any).eq("id", insertedVisit.id);
                    }
                  } else {
                    console.warn("[Sync] Photo upload failed, saving to pending_photos for retry:", uploadErr.message);
                    try {
                      await savePendingPhoto(insertedVisit.id, visit.photo_base64, insertedVisit.id, visit.client_generated_id);
                    } catch (idbErr) {
                      console.warn("[Sync] Failed to save photo to pending_photos:", idbErr);
                    }
                  }
                } catch (photoErr) {
                  console.warn("[Sync] Photo upload exception, saving to pending_photos for retry:", photoErr);
                  try {
                    await savePendingPhoto(insertedVisit.id, visit.photo_base64, insertedVisit.id, visit.client_generated_id);
                  } catch (idbErr) {
                    console.warn("[Sync] Failed to save photo to pending_photos:", idbErr);
                  }
                }
              }
            }
          }
        } catch (err: any) {
          await updateVisitSyncStatus(
            visit.client_generated_id,
            "error",
            err?.message || "Unknown sync error"
          );
          errors++;
        }
      }

      if (syncedVisitsCount > 0) {
        await removeSyncedVisits();
      }

      const scheduleResult = await syncPendingScheduleItemUpdates();
      synced += scheduleResult.synced;
      errors += scheduleResult.errors;
    } catch (err: any) {
      console.error("[Sync] Unhandled sync error:", err);
    }

    return { synced, errors };
  });
}

// Setup auto-sync on online event, visibility change, and app load
export function setupAutoSync(onSyncComplete?: () => void) {
  const doSync = async () => {
    if (!navigator.onLine) return;
    const result = await syncPendingVisits();
    if (result.synced > 0) {
      toast.success(`${result.synced} offline change(s) synced`);
      onSyncComplete?.();
    }
    if (result.errors > 0) {
      onSyncComplete?.();
    }
  };

  const handleOnline = () => {
    setTimeout(doSync, 1500);
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      setTimeout(doSync, 1000);
    }
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);

  if (navigator.onLine) {
    setTimeout(doSync, 2000);
  }

  return () => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}
