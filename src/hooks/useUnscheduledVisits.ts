import { useState, useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { debounce } from "@/lib/debounce";

// ─── unscheduled visits ───────────────────────────────────────────────────
// Fetches visits for this rep/date that are NOT linked to any schedule_item.
// Uses itemsRef (not items) so the function stays stable for repId/scheduleDate
// and can safely be called from the realtime subscription without stale closure.
export function useUnscheduledVisits(
  repId: string,
  scheduleDate: string,
  itemsRef: MutableRefObject<any[]>,
  expandedActiveIdRef: MutableRefObject<string | null>,
) {
  const [unscheduledVisits, setUnscheduledVisits] = useState<any[]>([]);
  const debouncedFetchRef = useRef<() => void>(() => {});

  const fetchUnscheduledVisits = useCallback(async () => {
    if (!repId) return;
    try {
      if (!navigator.onLine) return;
      const linkedVisitIds = itemsRef.current
        .map((i: any) => i.visit_id)
        .filter(Boolean) as string[];

      let query = supabase
        .from("visits")
        .select("*, customers(customer_name)")
        .eq("rep_id", repId)
        .eq("visit_date", scheduleDate)
        .not("status", "in", "(in_progress,superseded)");

      if (linkedVisitIds.length > 0) {
        query = (query as any).not("id", "in", `(${linkedVisitIds.join(",")})`);
      }

      const { data } = await query;
      setUnscheduledVisits(data ?? []);
    } catch {
      // network error — keep existing state
    }
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  // Realtime subscription for visits table — refreshes unscheduled visits on INSERT/UPDATE.
  useEffect(() => {
    debouncedFetchRef.current = debounce(() => { fetchUnscheduledVisits(); }, 300);
  }, [fetchUnscheduledVisits]);

  // Uses the same expandedActiveIdRef guard as the other subscriptions.
  useEffect(() => {
    if (!repId) return;
    const channel = supabase
      .channel(`visits-unscheduled-${repId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "visits", filter: `rep_id=eq.${repId}` }, () => {
        // Unscheduled visits are a separate list from the scheduled cards — whether a
        // scheduled card happens to be expanded has no bearing on this table. Always
        // refresh (debounced so a burst of near-simultaneous row changes collapses
        // into a single refresh); fetchUnscheduledVisits() is a lightweight read-only query.
        debouncedFetchRef.current();
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [repId, scheduleDate]); // eslint-disable-line react-hooks/exhaustive-deps

  return { unscheduledVisits, setUnscheduledVisits, fetchUnscheduledVisits };
}
