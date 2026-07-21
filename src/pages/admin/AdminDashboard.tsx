import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { fmtTime12h } from "@/lib/timeUtils";
import { A, PageHeader, StatCard, Pill, Tag, PulseKeyframes } from "@/lib/adminUi";
import { useAuth } from "@/hooks/useAuth";

// ─── local types ──────────────────────────────────────────────────────────────

interface RepRow { id: string; rep_name: string; }

// schedule_items now provides ONLY schedule structure: settled counts, areas,
// and the scheduled customer set. arrival_time / leaving_time / duration are no
// longer read here — in the event-outbox model they aren't written to
// schedule_items at check-in, only at checkout. Live status comes from
// visit_events instead (see below).
interface ScheduleItem {
  id: string;
  status: string;
  customer_id: string;
  customers: { customer_name: string; area: string | null } | null;
}

interface DailyScheduleRow {
  id: string;
  rep_id: string;
  schedule_items: ScheduleItem[];
}

interface VisitRow {
  id: string;
  rep_id: string;
  customer_id: string;
  client_generated_id: string | null;
  order_number: string | null;
  order_amount: number | null;
  duration_minutes: number | null;
  notes: string | null;
  status: string | null;
  created_at: string;
  customers: { customer_name: string } | null;
}

// The live-status / activity source of truth. One row per lifecycle event,
// written by syncEngine.insertVisitEvent. off_route never produces a row here.
interface VisitEventRow {
  id: string;
  client_id: string;
  rep_id: string;
  customer_id: string;
  event_type: "arrived" | "completed" | "skipped";
  event_time: string | null;   // plain time, SAST wall-clock ("HH:MM:SS")
  created_at: string;
  customers: { customer_name: string } | null;
}

type RepStatus =
  | "checked_in"
  | "travelling"
  | "day_complete"
  | "not_started"
  | "no_schedule";

interface RepCardData {
  rep: RepRow;
  status: RepStatus;
  hasSchedule: boolean;
  visited: number;
  skipped: number;
  total: number;
  progress: number;
  currentCustomer?: string;
  currentArrivalTime?: string;
  areas: string[];
}

interface ActivityEvent {
  type: "checkin" | "checkout" | "skip" | "offroute";
  repName: string;
  customerName: string;
  timeDisplay: string;
  sortKey: string;
  duration: number | null;
  notes: string | null;
}

interface SyncError {
  id: string;
  rep_id: string;
  error_type: string;
  message: string;
  context: Record<string, any> | null;
  created_at: string;
  cleared_at: string | null;
  reps?: { rep_name: string } | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

// Settled status from schedule_items only. "In progress" is NOT derived here
// anymore — visit_events owns that (an open 'arrived' overrides this in the
// card builder). schedule_items.status is written at checkout, so these
// settled states remain reliable at rest.
function deriveSettledStatus(items: ScheduleItem[]): RepStatus {
  if (!items.length) return "not_started";
  if (items.every((i) => i.status === "visited" || i.status === "skipped")) return "day_complete";
  if (items.some((i) => i.status === "visited" || i.status === "skipped")) return "travelling";
  return "not_started";
}

/** Format an ISO timestamp string to local "10:22 AM" */
function fmtFromIso(iso: string): string {
  const d = new Date(iso);
  const h = d.getHours(), m = d.getMinutes();
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

/** Extract a local HH:MM:SS sort key from an ISO timestamp */
function isoToLocalSortKey(iso: string): string {
  const d = new Date(iso);
  return (
    String(d.getHours()).padStart(2, "0") + ":" +
    String(d.getMinutes()).padStart(2, "0") + ":" +
    String(d.getSeconds()).padStart(2, "0")
  );
}

// ─── StatStrip ───────────────────────────────────────────────────────────────
// 4-card strip across the top of the dashboard. The top-level <StatCard> from
// adminUi is reused — this just lays them out.

function StatStrip({ stats, totalScheduled }: { stats: { visited: number; skipped: number; orders: number; orderValue: number }; totalScheduled: number }) {
  const visitPct = totalScheduled > 0 ? Math.round((stats.visited / totalScheduled) * 100) : 0;
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
      <StatCard label="Visits"      value={`${stats.visited} / ${totalScheduled}`} sub={`${visitPct}%`} accent={A.green} />
      <StatCard label="Skipped"     value={stats.skipped} />
      <StatCard label="Orders"      value={stats.orders} accent={A.sun} />
      <StatCard label="Order value" value={`R\u00A0${stats.orderValue.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`} accent={A.green} />
    </div>
  );
}

// ─── RepDeskRow ──────────────────────────────────────────────────────────────
// One row in the "Reps on the road" table — name + avatar, status pill,
// current customer, progress bar, area tags.

function RepDeskRow({ card }: { card: RepCardData }) {
  const pct = card.total > 0 ? Math.round(((card.visited + card.skipped) / card.total) * 100) : 0;
  const initials = card.rep.rep_name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 1.8fr 0.8fr 1fr", padding: "11px 16px", alignItems: "center", borderBottom: `1px solid ${A.borderRow}`, fontFamily: A.sans }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 999, background: A.greenSoft, color: A.green, fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials}</div>
        <div style={{ fontSize: 13, fontWeight: 500, color: A.ink }}>{card.rep.rep_name}</div>
      </div>
      <div><Pill status={card.status} /></div>
      <div style={{ fontSize: 12, color: card.currentCustomer ? A.ink : A.inkMute }}>
        {card.currentCustomer ? (
          <>
            {card.currentCustomer}
            {card.currentArrivalTime && (
              <span style={{ fontFamily: A.mono, fontSize: 11, color: A.inkMute, marginLeft: 6 }}>· {card.currentArrivalTime.slice(0, 5)}</span>
            )}
          </>
        ) : card.hasSchedule ? "—" : <span style={{ fontStyle: "italic" }}>No schedule today</span>}
      </div>
      <div>
        {card.hasSchedule && card.total > 0 ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, height: 4, background: A.borderSoft, borderRadius: 999, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: card.status === "day_complete" ? A.greenMid : A.green, borderRadius: 999, transition: "width 0.3s" }} />
            </div>
            <div style={{ fontFamily: A.mono, fontSize: 11, color: A.inkSoft, minWidth: 28, textAlign: "right" }}>{card.visited + card.skipped}/{card.total}</div>
          </div>
        ) : <span style={{ fontSize: 11, color: A.inkMute }}>—</span>}
      </div>
      <div style={{ display: "flex", gap: 4, justifyContent: "flex-end", flexWrap: "wrap" }}>
        {card.areas.map((a) => <Tag key={a}>{a}</Tag>)}
      </div>
    </div>
  );
}

// ─── ActivityFeedRow ─────────────────────────────────────────────────────────
// One row in the live activity feed. Colour-coded badge maps to event kind.

function ActivityFeedRow({ event }: { event: ActivityEvent }) {
  const config = {
    checkin:  { c: A.green,    label: "IN",   bg: A.greenSoft, verb: "arrived at" },
    checkout: { c: A.greenMid, label: "OUT",  bg: A.greenWash, verb: "left" },
    skip:     { c: A.danger,   label: "SKIP", bg: A.dangerBg,  verb: "skipped" },
    offroute: { c: A.sun,      label: "OFF",  bg: A.sunBg,     verb: "logged off-route at" },
  }[event.type];

  return (
    <div style={{ display: "flex", gap: 11, padding: "10px 16px", borderBottom: `1px solid ${A.borderRow}`, alignItems: "flex-start", fontFamily: A.sans }}>
      <div style={{ fontFamily: A.mono, fontSize: 11, color: A.inkMute, paddingTop: 1, minWidth: 44 }}>{event.timeDisplay}</div>
      <div style={{ minWidth: 38 }}>
        <span style={{ display: "inline-block", padding: "1px 5px", background: config.bg, color: config.c, fontFamily: A.mono, fontSize: 9.5, fontWeight: 700, borderRadius: 3, letterSpacing: 0.4 }}>{config.label}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.4, color: A.ink }}>
        <div>
          <span style={{ fontWeight: 600 }}>{event.repName}</span>{" "}
          <span style={{ color: A.inkMute }}>{config.verb}</span>{" "}
          {event.customerName}
        </div>
        {(event.duration != null || event.notes) && (
          <div style={{ fontSize: 11.5, color: A.inkMute, marginTop: 2 }}>
            {event.duration != null && <span style={{ fontFamily: A.mono }}>{event.duration}m</span>}
            {event.duration != null && event.notes && <span> · </span>}
            {event.notes && <span style={{ fontStyle: "italic" }}>"{event.notes}"</span>}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── SyncErrorPanel ──────────────────────────────────────────────────────────
function SyncErrorPanel() {
  const [errors, setErrors] = useState<SyncError[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const { user } = useAuth();

  useEffect(() => {
    fetchErrors();
    const channel = supabase
      .channel("sync-errors-panel")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "sync_errors" }, () => fetchErrors())
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, []);

  const fetchErrors = async () => {
    const { data } = await (supabase as any)
      .from("sync_errors")
      .select("*, reps(rep_name)")
      .is("cleared_at", null)
      .order("created_at", { ascending: false });
    if (data) setErrors(data);
  };

  const clearError = async (id: string) => {
    setClearing(id);
    await (supabase as any)
      .from("sync_errors")
      .update({ cleared_at: new Date().toISOString(), cleared_by: user?.id })
      .eq("id", id);
    setErrors((prev) => prev.filter((e) => e.id !== id));
    setClearing(null);
  };

  if (errors.length === 0) return null;

  return (
    <div style={{
      position: "fixed",
      bottom: 20,
      right: 20,
      zIndex: 100,
      fontFamily: A.sans,
      width: expanded ? 340 : "auto",
    }}>
      {expanded && (
        <div style={{
          background: A.panel,
          border: `1px solid ${A.border}`,
          borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
          marginBottom: 8,
          overflow: "hidden",
        }}>
          <div style={{
            padding: "10px 14px",
            borderBottom: `1px solid ${A.border}`,
            fontSize: 12,
            fontWeight: 700,
            color: A.ink,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}>
            Sync Errors
            <button
              type="button"
              onClick={() => setExpanded(false)}
              style={{ background: "none", border: "none", cursor: "pointer", color: A.inkMute, fontSize: 16, lineHeight: 1, padding: 0 }}
            >
              ×
            </button>
          </div>
          <div style={{ maxHeight: 320, overflowY: "auto" }}>
            {errors.map((err) => (
              <div key={err.id} style={{
                padding: "10px 14px",
                borderBottom: `1px solid ${A.borderRow}`,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 600, color: A.ink }}>
                    {err.reps?.rep_name ?? "Unknown rep"}
                  </div>
                  <div style={{ fontSize: 10.5, color: A.inkMute, whiteSpace: "nowrap", fontFamily: A.mono }}>
                    {new Date(err.created_at).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}
                  </div>
                </div>
                <div style={{ fontSize: 11, color: A.inkMute }}>{err.message}</div>
                {err.context?.schedule_date && (
                  <div style={{ fontSize: 10.5, color: A.inkMute, fontFamily: A.mono }}>
                    Date: {err.context.schedule_date}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() => clearError(err.id)}
                  disabled={clearing === err.id}
                  style={{
                    alignSelf: "flex-end",
                    marginTop: 2,
                    padding: "3px 10px",
                    fontSize: 11,
                    fontWeight: 600,
                    background: A.panelTint,
                    border: `1px solid ${A.border}`,
                    borderRadius: 6,
                    color: A.inkSoft,
                    cursor: clearing === err.id ? "not-allowed" : "pointer",
                    fontFamily: A.sans,
                  }}
                >
                  {clearing === err.id ? "Clearing…" : "Clear"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 13px",
          background: A.dangerBg,
          border: `1px solid ${A.danger}`,
          borderRadius: 20,
          color: A.danger,
          fontSize: 12,
          fontWeight: 700,
          fontFamily: A.sans,
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.10)",
        }}
      >
        <span style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: A.danger,
          flexShrink: 0,
        }} />
        {errors.length} sync {errors.length === 1 ? "error" : "errors"}
      </button>
    </div>
  );
}

// ─── AdminDashboard ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const todayStr = new Date().toISOString().split("T")[0];

  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState<string | null>(null);
  const [reps,        setReps]        = useState<RepRow[]>([]);
  const [schedules,   setSchedules]   = useState<DailyScheduleRow[]>([]);
  const [visits,      setVisits]      = useState<VisitRow[]>([]);
  const [visitEvents, setVisitEvents] = useState<VisitEventRow[]>([]);
  const [activityRepFilter, setActivityRepFilter] = useState<string>("all");
  const [activityDropdownOpen, setActivityDropdownOpen] = useState(false);

  const activityDropdownRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!activityDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (activityDropdownRef.current && !activityDropdownRef.current.contains(e.target as Node)) {
        setActivityDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [activityDropdownOpen]);

  // Ref keeps the realtime callback pointing at the latest fetchData closure
  // without needing to recreate the channels on every render.
  const fetchRef = useRef<() => Promise<void>>(async () => {});

  const fetchData = async () => {
    try {
      // Step 1 — fetch active reps first so we can drive pre-generation per rep
      const repsRes = await supabase
        .from("reps")
        .select("id, rep_name")
        .eq("is_active", true)
        .order("rep_name");

      if (repsRes.error) throw repsRes.error;
      const activeReps = repsRes.data ?? [];

      // Step 2 — pre-generate (and self-heal) today's schedule for every active rep.
      // Runs in parallel; errors per rep are swallowed — a rep with no template is valid.
      try {
        // Determine the correct weekly template id for today once, shared by all reps.
        const { data: weekOrder } = await (supabase.rpc as any)(
          "get_week_order_for_date",
          { p_date: todayStr }
        );

        let correctWeeklyTemplateId: string | null = null;
        if (weekOrder != null) {
          const { data: tpl } = await supabase
            .from("weekly_templates")
            .select("id")
            .eq("sort_order", weekOrder)
            .maybeSingle();
          correctWeeklyTemplateId = tpl?.id ?? null;
        }

        await Promise.all(
          activeReps.map(async (rep) => {
            try {
              // Check for an existing schedule row for this rep today.
              // Cast to any: weekly_template_id is not yet in the generated types.ts snapshot.
              const { data: existing } = await (supabase
                .from("daily_schedules")
                .select("id, weekly_template_id")
                .eq("rep_id", rep.id)
                .eq("schedule_date", todayStr)
                .maybeSingle() as any) as { data: { id: string; weekly_template_id: string | null } | null };

              // Self-heal: if the row uses the wrong template AND the rep has not
              // started their day, delete it so it regenerates from the right week.
              if (
                existing &&
                correctWeeklyTemplateId &&
                existing.weekly_template_id !== correctWeeklyTemplateId
              ) {
                // Authoritative "has the rep started today?" signal in the
                // event-outbox model. arrival_time is NO LONGER written to
                // schedule_items at check-in, so schedule_items alone can't see
                // an in-progress visit — a checked-in rep would look "unstarted"
                // and get their schedule deleted out from under them. visit_events
                // is the guard.
                const { count: eventCount } = await (supabase as any)
                  .from("visit_events")
                  .select("id", { count: "exact", head: true })
                  .eq("rep_id", rep.id)
                  .eq("visit_date", todayStr);

                // Belt-and-suspenders: schedule_items.status is still written at
                // checkout, so a completed/skipped stop also blocks the delete.
                const { count: startedCount } = await supabase
                  .from("schedule_items")
                  .select("id", { count: "exact", head: true })
                  .eq("schedule_id", existing.id)
                  .or("arrival_time.not.is.null,status.in.(visited,skipped)");

                if ((eventCount ?? 0) === 0 && (startedCount ?? 0) === 0) {
                  await supabase
                    .from("daily_schedules")
                    .delete()
                    .eq("id", existing.id);
                }
              }

              // Idempotent — creates the row if absent, no-ops if it already exists
              await supabase.rpc("auto_generate_daily_schedule", {
                p_rep_id:        rep.id,
                p_schedule_date: todayStr,
              });
            } catch {
              // Per-rep failure is non-fatal — card will show "No Schedule"
            }
          })
        );
      } catch {
        // Week-order or template lookup failed (e.g. offline) — skip pre-generation entirely
      }

      // Step 3 — fetch schedules, visits, and events now that rows are guaranteed to exist
      const [schedulesRes, visitsRes, eventsRes] = await Promise.all([
        supabase
          .from("daily_schedules")
          .select(
            "id, rep_id, schedule_items(id, status, customer_id, customers(customer_name, area))"
          )
          .eq("schedule_date", todayStr),

        (supabase
          .from("visits")
          .select("id, rep_id, customer_id, client_generated_id, order_number, order_amount, duration_minutes, notes, status, created_at, customers(customer_name)")
          .eq("visit_date", todayStr) as any)
          .neq("status", "in_progress")
          .eq("is_deleted", false),

        // visit_events: cast to any (not in the generated types snapshot yet).
        // Live in-progress status + activity feed source of truth.
        (supabase as any)
          .from("visit_events")
          .select("id, client_id, rep_id, customer_id, event_type, event_time, created_at, customers(customer_name)")
          .eq("visit_date", todayStr),
      ]);

      if (schedulesRes.error) throw schedulesRes.error;
      if (visitsRes.error)    throw visitsRes.error;
      if (eventsRes.error)    throw eventsRes.error;

      setReps(activeReps);
      setSchedules((schedulesRes.data ?? []) as unknown as DailyScheduleRow[]);
      setVisits((visitsRes.data ?? []) as unknown as VisitRow[]);
      setVisitEvents((eventsRes.data ?? []) as unknown as VisitEventRow[]);
      setError(null);
    } catch (err: any) {
      setError(err?.message ?? "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  };

  fetchRef.current = fetchData;

  useEffect(() => {
    fetchData();

    const itemsChannel = supabase
      .channel("dashboard-schedule-items")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "schedule_items" },
        () => { fetchRef.current(); }
      )
      .subscribe();

    const visitsChannel = supabase
      .channel("dashboard-visits")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visits" },
        () => { fetchRef.current(); }
      )
      .subscribe();

    // Live status + activity feed depend on this. NOTE: requires realtime
    // replication to be enabled on visit_events (Supabase → Database →
    // Replication). Without it, a pure check-in ('arrived') — which writes
    // ONLY a visit_events row and touches neither visits nor schedule_items —
    // will not trigger a refetch, so live "checked in" won't appear until the
    // next refetch. Checkout/skip still refetch via the visits/schedule_items
    // channels regardless.
    const eventsChannel = supabase
      .channel("dashboard-visit-events")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "visit_events" },
        () => { fetchRef.current(); }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(itemsChannel);
      supabase.removeChannel(visitsChannel);
      supabase.removeChannel(eventsChannel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ───────────────────────────────────────────────────────────

  const allItems = schedules.flatMap((s) => s.schedule_items);

  const stats = {
    // Settled visit counts from schedule_items — off_route never produces a
    // schedule_item so it's already excluded. Written at checkout, reliable.
    visited:    allItems.filter((i) => i.status === "visited").length,
    skipped:    allItems.filter((i) => i.status === "skipped").length,
    // Orders and order value: include off_route — those orders are real.
    orders:     visits.filter((v) => v.order_number != null && v.order_number !== "").length,
    orderValue: visits.reduce((sum, v) => sum + (Number(v.order_amount) || 0), 0),
  };

  const scheduleByRepId: Record<string, DailyScheduleRow> = {};
  for (const s of schedules) scheduleByRepId[s.rep_id] = s;

  const repById: Record<string, RepRow> = {};
  for (const r of reps) repById[r.id] = r;

  // Group events by rep for status derivation.
  const eventsByRep: Record<string, VisitEventRow[]> = {};
  for (const e of visitEvents) (eventsByRep[e.rep_id] ??= []).push(e);

  // visits keyed by clientId — enriches activity feed (checkout duration, skip notes).
  const visitByClientId: Record<string, VisitRow> = {};
  for (const v of visits) if (v.client_generated_id) visitByClientId[v.client_generated_id] = v;

  const repCards: RepCardData[] = reps.map((rep) => {
    const sch   = scheduleByRepId[rep.id];
    const items = sch?.schedule_items ?? [];
    const evs   = eventsByRep[rep.id] ?? [];

    // Open visit = an 'arrived' whose clientId has no terminal event yet.
    const terminalClientIds = new Set(
      evs.filter((e) => e.event_type === "completed" || e.event_type === "skipped").map((e) => e.client_id)
    );
    const openArrivals = evs
      .filter((e) => e.event_type === "arrived" && !terminalClientIds.has(e.client_id))
      .sort((a, b) => (b.event_time ?? "").localeCompare(a.event_time ?? ""));
    const openEvent = openArrivals[0];

    const visited = items.filter((i) => i.status === "visited").length;
    const skipped = items.filter((i) => i.status === "skipped").length;
    const total   = items.length;

    // Precedence: an open visit_event always means "checked in" — even for an
    // ad-hoc-only rep with no schedule today (new live-ad-hoc capability).
    let status: RepStatus;
    if (openEvent)       status = "checked_in";
    else if (!sch)       status = "no_schedule";
    else                 status = deriveSettledStatus(items);

    const areaSet = new Set<string>();
    items.forEach((item) => {
      const area = item.customers?.area;
      if (area && area.trim()) areaSet.add(area);
    });
    const areas = Array.from(areaSet);

    return {
      rep, status, hasSchedule: !!sch,
      visited, skipped, total,
      progress: total > 0 ? (visited + skipped) / total : 0,
      currentCustomer:    openEvent?.customers?.customer_name ?? undefined,
      currentArrivalTime: openEvent?.event_time ?? undefined,
      areas,
    };
  });

  const totalScheduled = repCards.reduce((sum, card) => sum + card.total, 0);

  // ── Activity feed ──────────────────────────────────────────────────────────
  // check-in / check-out / skip come from visit_events (live, distinct times).
  // off-route comes from visits (never emits a visit_events row).
  const activityEvents: ActivityEvent[] = [];

  for (const ev of visitEvents) {
    const repName      = repById[ev.rep_id]?.rep_name ?? "Unknown";
    const customerName = ev.customers?.customer_name ?? "Unknown";
    const t            = ev.event_time ?? "00:00:00";

    if (ev.event_type === "arrived") {
      activityEvents.push({
        type: "checkin", repName, customerName,
        timeDisplay: fmtTime12h(t), sortKey: t,
        duration: null, notes: null,
      });
    } else if (ev.event_type === "completed") {
      const linked = visitByClientId[ev.client_id];
      activityEvents.push({
        type: "checkout", repName, customerName,
        timeDisplay: fmtTime12h(t), sortKey: t,
        duration: linked?.duration_minutes ?? null,
        notes: null,
      });
    }
    // Skips are NOT rendered from visit_events — a skip has no wall-clock time.
    // They come from the visits table below (using created_at) instead.
  }

  // Skips and off-route orders both come from the visits table. Neither
  // captures a wall-clock event time, so both use created_at (the record
  // timestamp) for their position in the feed.
  for (const v of visits) {
    const repName = repById[v.rep_id]?.rep_name ?? "Unknown";
    const customerName = v.customers?.customer_name ?? "Unknown";

    if (v.status === "skipped") {
      activityEvents.push({
        type: "skip",
        repName,
        customerName,
        timeDisplay: fmtFromIso(v.created_at),
        sortKey: isoToLocalSortKey(v.created_at),
        duration: null,
        notes: v.notes,
      });
    } else if (v.status === "off_route") {
      activityEvents.push({
        type: "offroute",
        repName,
        customerName,
        timeDisplay: fmtFromIso(v.created_at),
        sortKey: isoToLocalSortKey(v.created_at),
        duration: null,
        notes: null,
      });
    }
  }

  activityEvents.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

  // Derive filtered activity events based on rep filter
  const filteredActivityEvents = activityRepFilter === "all"
    ? activityEvents
    : activityEvents.filter((ev) => ev.repName === (reps.find((r) => r.id === activityRepFilter)?.rep_name ?? ""));

  // ── Render ─────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: A.bg }}>
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: A.bg, fontFamily: A.sans, color: A.danger, fontSize: 13 }}>
        {error}
      </div>
    );
  }

  return (
    <>
      <div style={{ flex: 1, display: "flex", flexDirection: "column", background: A.bg, minHeight: 0, fontFamily: A.sans, color: A.ink }}>
        <PulseKeyframes />

      <PageHeader
        title="Today"
        subtitle={format(new Date(), "EEEE, d MMMM yyyy")}
        right={
          <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 10px", background: A.greenSoft, borderRadius: 6 }}>
            <span style={{ position: "relative", display: "inline-block", width: 6, height: 6 }}>
              <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: A.green }} />
              <span style={{ position: "absolute", inset: -2, borderRadius: 999, background: A.green, opacity: 0.25, animation: "pulseA 1.4s ease-out infinite" }} />
            </span>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: A.green }}>Realtime · synced</span>
          </div>
        }
      />

      <div style={{ padding: "18px 24px", overflow: "auto", flex: 1 }}>
        {/* Stat strip */}
        <div style={{ marginBottom: 16 }}>
          <StatStrip stats={stats} totalScheduled={totalScheduled} />
        </div>

        {/* Two-column: reps table + activity feed */}
        <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1fr", gap: 14 }}>
          {/* Reps on the road */}
          <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${A.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Reps on the road</div>
              <div style={{ fontFamily: A.mono, fontSize: 11, color: A.inkMute }}>{repCards.length} active</div>
            </div>
            {repCards.length === 0 ? (
              <div style={{ padding: "40px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>No active reps found.</div>
            ) : (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 1.8fr 0.8fr 1fr", padding: "8px 16px", fontSize: 10.5, color: A.inkMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", borderBottom: `1px solid ${A.borderSoft}` }}>
                  <div>Name</div>
                  <div>Status</div>
                  <div>Current</div>
                  <div>Progress</div>
                  <div style={{ textAlign: "right" }}>Areas</div>
                </div>
                {repCards.map((card) => (
                  <RepDeskRow key={card.rep.id} card={card} />
                ))}
              </>
            )}
          </div>

          {/* Activity feed */}
          <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${A.border}` }}>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Activity</div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div ref={activityDropdownRef} style={{ position: "relative" }}>
                  <button
                    type="button"
                    onClick={() => setActivityDropdownOpen((v) => !v)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      height: 32,
                      padding: "0 10px",
                      border: `1px solid ${activityRepFilter !== "all" ? A.green : A.border}`,
                      borderRadius: 8,
                      background: activityRepFilter !== "all" ? A.green : A.panel,
                      color: activityRepFilter !== "all" ? "#fff" : A.ink,
                      fontSize: 12,
                      fontWeight: 500,
                      fontFamily: A.sans,
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {activityRepFilter === "all"
                      ? "All reps"
                      : reps.find((r) => r.id === activityRepFilter)?.rep_name ?? "All reps"}
                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>

                  {activityDropdownOpen && (
                    <div style={{
                      position: "absolute",
                      top: "calc(100% + 4px)",
                      right: 0,
                      zIndex: 50,
                      minWidth: 160,
                      background: A.panel,
                      border: `1px solid ${A.border}`,
                      borderRadius: 8,
                      boxShadow: "0 4px 16px rgba(0,0,0,0.10)",
                      overflow: "hidden",
                      fontFamily: A.sans,
                    }}>
                      {[{ id: "all", rep_name: "All reps" }, ...reps].map((r) => {
                        const isSelected = activityRepFilter === r.id;
                        return (
                          <button
                            key={r.id}
                            type="button"
                            onClick={() => { setActivityRepFilter(r.id); setActivityDropdownOpen(false); }}
                            style={{
                              display: "flex",
                              alignItems: "center",
                              gap: 8,
                              width: "100%",
                              padding: "8px 12px",
                              background: isSelected ? A.greenSoft : "transparent",
                              color: isSelected ? A.green : A.ink,
                              border: "none",
                              fontSize: 12.5,
                              fontWeight: isSelected ? 600 : 400,
                              fontFamily: A.sans,
                              cursor: "pointer",
                              textAlign: "left",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected) {
                                (e.currentTarget as HTMLButtonElement).style.background = A.greenSoft;
                                (e.currentTarget as HTMLButtonElement).style.color = A.green;
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!isSelected) {
                                (e.currentTarget as HTMLButtonElement).style.background = "transparent";
                                (e.currentTarget as HTMLButtonElement).style.color = A.ink;
                              }
                            }}
                          >
                            {isSelected && (
                              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            )}
                            {!isSelected && <span style={{ width: 11, display: "inline-block" }} />}
                            {r.rep_name}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                <div style={{ fontFamily: A.mono, fontSize: 11, color: A.inkMute }}>today · live</div>
              </div>
            </div>
            {filteredActivityEvents.length === 0 ? (
              <div style={{ padding: "40px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>{activityRepFilter === "all" ? "No activity yet today." : "No activity from this rep yet today."}</div>
            ) : (
              <div style={{ maxHeight: 600, overflow: "auto" }}>
                {filteredActivityEvents.map((ev, i) => <ActivityFeedRow key={i} event={ev} />)}
              </div>
            )}
          </div>
        </div>
      </div>
      <SyncErrorPanel />
    </div>
    </>
  );
}