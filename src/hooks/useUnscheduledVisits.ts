import { useState, useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { supabase } from "@/integrations/supabase/client";
import { getPendingVisitEvents } from "@/lib/offlineDb";
import { debounce } from "@/lib/debounce";

// ─── outbox overlay for unscheduled visits ──────────────────────────────────
// Ad-hoc completions and off-route orders logged OFFLINE exist only in the
// visit_outbox until sync drains — the server has no row for them yet, so a
// fetch here would (truthfully, from the server's view) omit them, and the
// Done tab would show nothing for work the rep genuinely captured. This
// synthesizes visit-shaped rows from pending terminal outbox events and
// merges them ahead of the server's list, deduplicated by client_generated_id
// so a row that HAS synced is never doubled. Once the outbox drains the
// pending events disappear and the server list stands on its own — the
// overlay self-retires exactly like the scheduled-items overlay in
// DailySchedule.tsx. Scheduled-visit 'completed' events (those carrying a
// scheduleItemId) are excluded — they belong to the schedule overlay, not
// this list.
async function overlayPendingUnscheduled(serverVisits: any[], visitDate: string): Promise<any[]> {
  try {
    const pending = await getPendingVisitEvents();
    const relevant = pending.filter(
      (e) =>
        e.visitDate === visitDate &&
        (e.type === "off_route" || (e.type === "completed" && !e.scheduleItemId))
    );
    if (relevant.length === 0) return serverVisits;

    const syncedClientIds = new Set(
      serverVisits.map((v: any) => v.client_generated_id).filter(Boolean)
    );

    const synthesized = relevant
      .filter((e) => !syncedClientIds.has(e.clientId))
      .map((e) => ({
        id: e.clientId, // stable key for rendering; replaced by the real row once synced
        client_generated_id: e.clientId,
        rep_id: e.repId,
        customer_id: e.customerId,
        visit_date: e.visitDate,
        arrival_time: e.arrivalTime ?? null,
        leaving_time: e.leavingTime ?? null,
        duration_minutes: e.durationMinutes ?? null,
        notes: e.notes ?? null,
        status: e.type === "off_route" ? "off_route" : "visited",
        order_number: e.order?.order_number ?? null,
        order_quantity: e.order?.order_quantity ?? null,
        order_amount: e.order?.order_amount ?? null,
        photo_url: null, // photo uploads with the sync; thumbnail appears then
        customers: { customer_name: e.customerName ?? null },
      }));

    return [...synthesized, ...serverVisits];
  } catch {
    return serverVisits; // IDB read failure — never block rendering on the overlay
  }
}

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
      if (!navigator.onLine) {
        // Offline: the server can't be asked, but the outbox still knows what
        // was captured. Overlay onto the current list so offline-logged
        // ad-hoc/off-route work appears in the Done tab immediately.
        setUnscheduledVisits((prev) => {
          // fire-and-forget async overlay against current state
          overlayPendingUnscheduled(prev, scheduleDate).then((next) => {
            setUnscheduledVisits(next);
          }).catch(() => {});
          return prev;
        });
        return;
      }
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
      const overlaid = await overlayPendingUnscheduled(data ?? [], scheduleDate);
      setUnscheduledVisits(overlaid);
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
