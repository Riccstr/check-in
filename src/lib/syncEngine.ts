import { supabase } from "@/integrations/supabase/client";
import {
  getPendingVisits,
  updateVisitSyncStatus,
  removeSyncedVisits,
  getPendingScheduleItemUpdates,
  updateScheduleItemUpdateSyncStatus,
  removeSyncedScheduleItemUpdates,
} from "./offlineDb";
import { toast } from "sonner";
import { reverseGeocode } from "./geolocation";
import { base64ToBlob } from "./imageCompressor";

let syncing = false;

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
  if (syncing) return { synced: 0, errors: 0 };
  syncing = true;

  let synced = 0;
  let errors = 0;
  let syncedVisitsCount = 0;

  try {
    const pending = await getPendingVisits();
    pending.sort((a, b) => a.created_at_local.localeCompare(b.created_at_local));

    for (const visit of pending) {
      try {
        // Check if already exists (idempotency)
        const { data: existing } = await supabase
          .from("visits")
          .select("id")
          .eq("client_generated_id", visit.client_generated_id)
          .maybeSingle();

        if (existing) {
          await updateVisitSyncStatus(visit.client_generated_id, "synced");
          synced++;
          syncedVisitsCount++;
          continue;
        }

        // Duplicate check: same rep + customer + date + times
        const payload = visit.payload as any;
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

        // Attempt reverse geocode if we have coords but no address
        if (payload.latitude && payload.longitude && !payload.location_address) {
          try {
            const addr = await reverseGeocode(payload.latitude, payload.longitude);
            if (addr) payload.location_address = addr;
          } catch { /* non-blocking */ }
        }

        const { data: insertedVisit, error } = await supabase
          .from("visits")
          .insert(payload)
          .select("id")
          .maybeSingle();

        if (error) {
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
                }
              } catch (photoErr) {
                console.warn("[Sync] Photo upload failed:", photoErr);
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
  } finally {
    syncing = false;
  }

  return { synced, errors };
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
    // Small delay to let connection stabilize
    setTimeout(doSync, 1500);
  };

  const handleVisibility = () => {
    if (document.visibilityState === "visible" && navigator.onLine) {
      setTimeout(doSync, 1000);
    }
  };

  window.addEventListener("online", handleOnline);
  document.addEventListener("visibilitychange", handleVisibility);

  // Sync on load if online
  if (navigator.onLine) {
    setTimeout(doSync, 2000);
  }

  return () => {
    window.removeEventListener("online", handleOnline);
    document.removeEventListener("visibilitychange", handleVisibility);
  };
}
