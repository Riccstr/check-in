import { supabase } from "@/integrations/supabase/client";
import { getPendingVisits, updateVisitSyncStatus } from "./offlineDb";

let syncing = false;

export async function syncPendingVisits(): Promise<{ synced: number; errors: number }> {
  if (syncing) return { synced: 0, errors: 0 };
  syncing = true;

  let synced = 0;
  let errors = 0;

  try {
    const pending = await getPendingVisits();
    // Sort by created_at_local chronological order
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
          // Already synced
          await updateVisitSyncStatus(visit.client_generated_id, "synced");
          synced++;
          continue;
        }

        // Duplicate check: same rep + customer + date within 2 minutes
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
          // Already exists (duplicate), mark as synced
          await updateVisitSyncStatus(visit.client_generated_id, "synced");
          synced++;
          continue;
        }

        const { error } = await supabase.from("visits").insert(visit.payload);

        if (error) {
          await updateVisitSyncStatus(visit.client_generated_id, "error", error.message);
          errors++;
        } else {
          await updateVisitSyncStatus(visit.client_generated_id, "synced");
          synced++;
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
  } finally {
    syncing = false;
  }

  return { synced, errors };
}

// Setup auto-sync on online event and app load
export function setupAutoSync(onSyncComplete?: () => void) {
  const doSync = async () => {
    if (!navigator.onLine) return;
    const result = await syncPendingVisits();
    if (result.synced > 0 || result.errors > 0) {
      onSyncComplete?.();
    }
  };

  window.addEventListener("online", doSync);

  // Sync on load if online
  if (navigator.onLine) {
    setTimeout(doSync, 2000);
  }

  return () => {
    window.removeEventListener("online", doSync);
  };
}
