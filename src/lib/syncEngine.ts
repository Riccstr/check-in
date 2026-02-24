import { supabase } from "@/integrations/supabase/client";
import { getPendingVisits, updateVisitSyncStatus, removeSyncedVisits } from "./offlineDb";
import { toast } from "sonner";

let syncing = false;

export async function syncPendingVisits(): Promise<{ synced: number; errors: number }> {
  if (syncing) return { synced: 0, errors: 0 };
  syncing = true;

  let synced = 0;
  let errors = 0;

  try {
    const pending = await getPendingVisits();
    if (pending.length === 0) return { synced: 0, errors: 0 };

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
          await updateVisitSyncStatus(visit.client_generated_id, "synced");
          synced++;
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

    // Clean up synced visits from IDB
    if (synced > 0) {
      await removeSyncedVisits();
    }
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
      toast.success(`${result.synced} offline visit(s) synced`);
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
