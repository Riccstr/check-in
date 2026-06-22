import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { fmtTime12h } from "@/lib/timeUtils";
import { A, PageHeader, StatCard, Pill, Tag, ToolbarSearch, PulseKeyframes } from "@/lib/adminUi";

// ─── local types ──────────────────────────────────────────────────────────────

interface RepRow { id: string; rep_name: string; }

interface ScheduleItem {
  id: string;
  status: string;
  arrival_time: string | null;
  leaving_time: string | null;
  duration_minutes: number | null;
  notes: string | null;
  sort_order: number;
  customer_id: string;
  visit_id: string | null;
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
  order_number: string | null;
  order_amount: number | null;
  status: string | null;
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

// ─── helpers ──────────────────────────────────────────────────────────────────

function deriveStatus(items: ScheduleItem[]): RepStatus {
  if (!items.length) return "not_started";
  if (items.find((i) => i.arrival_time && !i.leaving_time)) return "checked_in";
  if (items.every((i) => i.status === "visited" || i.status === "skipped")) return "day_complete";
  if (items.some((i) => i.leaving_time) && items.some((i) => i.status === "pending")) return "travelling";
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

// ─── AdminDashboard ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const todayStr = new Date().toISOString().split("T")[0];

  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState<string | null>(null);
  const [reps,      setReps]      = useState<RepRow[]>([]);
  const [schedules, setSchedules] = useState<DailyScheduleRow[]>([]);
  const [visits,    setVisits]    = useState<VisitRow[]>([]);

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

              // Self-heal: if the row uses the wrong template and no visits have started, delete it
              if (
                existing &&
                correctWeeklyTemplateId &&
                existing.weekly_template_id !== correctWeeklyTemplateId
              ) {
                const { count } = await supabase
                  .from("schedule_items")
                  .select("id", { count: "exact", head: true })
                  .eq("schedule_id", existing.id)
                  .or("arrival_time.not.is.null,status.in.(visited,skipped)");

                if ((count ?? 0) === 0) {
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

      // Step 3 — fetch schedules and visits now that rows are guaranteed to exist
      const [schedulesRes, visitsRes] = await Promise.all([
        supabase
          .from("daily_schedules")
          .select(
            "id, rep_id, schedule_items(id, status, arrival_time, leaving_time, duration_minutes, notes, sort_order, customer_id, visit_id, customers(customer_name, area))"
          )
          .eq("schedule_date", todayStr),

        (supabase
          .from("visits")
          .select("id, rep_id, customer_id, order_number, order_amount, status, created_at, customers(customer_name)")
          .eq("visit_date", todayStr) as any)
          .neq("status", "in_progress")
          .eq("is_deleted", false),
      ]);

      if (schedulesRes.error) throw schedulesRes.error;
      if (visitsRes.error)    throw visitsRes.error;

      setReps(activeReps);
      setSchedules((schedulesRes.data ?? []) as unknown as DailyScheduleRow[]);
      setVisits((visitsRes.data ?? []) as unknown as VisitRow[]);
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

    return () => {
      supabase.removeChannel(itemsChannel);
      supabase.removeChannel(visitsChannel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived data ───────────────────────────────────────────────────────────

  const allItems = schedules.flatMap((s) => s.schedule_items);

  const stats = {
    // Visit counts from schedule_items — off_route visits never produce schedule_items
    // so they are already excluded; guard explicitly for safety.
    visited:    allItems.filter((i) => i.status === "visited").length,
    skipped:    allItems.filter((i) => i.status === "skipped").length,
    // Orders and order value: include off_route — those orders are real.
    orders:     visits.filter((v) => v.order_number != null && v.order_number !== "").length,
    orderValue: visits.reduce((sum, v) => sum + (Number(v.order_amount) || 0), 0),
  };

  // Build rep cards, one per active rep (no-schedule reps still get a card)
  const scheduleByRepId: Record<string, DailyScheduleRow> = {};
  for (const s of schedules) scheduleByRepId[s.rep_id] = s;

  const repCards: RepCardData[] = reps.map((rep) => {
    const sch = scheduleByRepId[rep.id];
    if (!sch) {
      return { rep, status: "no_schedule", hasSchedule: false, visited: 0, skipped: 0, total: 0, progress: 0, areas: [] };
    }

    const items   = sch.schedule_items;
    const status  = deriveStatus(items);
    const visited = items.filter((i) => i.status === "visited").length;
    const skipped = items.filter((i) => i.status === "skipped").length;
    const total   = items.length;

    const inProgressItem =
      status === "checked_in"
        ? items.find((i) => i.arrival_time && !i.leaving_time)
        : undefined;

    const areaSet = new Set<string>();
    items.forEach((item) => {
      const area = item.customers?.area;
      if (area && area.trim()) areaSet.add(area);
    });
    const areas = Array.from(areaSet);

    return {
      rep, status, hasSchedule: true,
      visited, skipped, total,
      progress: total > 0 ? (visited + skipped) / total : 0,
      currentCustomer:    inProgressItem?.customers?.customer_name,
      currentArrivalTime: inProgressItem?.arrival_time ?? undefined,
      areas,
    };
  });

  const totalScheduled = repCards.reduce((sum, card) => sum + card.total, 0);

  // Build activity feed events from schedule_items
  const visitsById: Record<string, VisitRow> = {};
  for (const v of visits) visitsById[v.id] = v;

  const repById: Record<string, RepRow> = {};
  for (const r of reps) repById[r.id] = r;

  const activityEvents: ActivityEvent[] = [];

  for (const sch of schedules) {
    const repName = repById[sch.rep_id]?.rep_name ?? "Unknown";

    for (const item of sch.schedule_items) {
      const customerName = item.customers?.customer_name ?? "Unknown";

      if (item.arrival_time) {
        activityEvents.push({
          type: "checkin", repName, customerName,
          timeDisplay: fmtTime12h(item.arrival_time),
          sortKey:     item.arrival_time,
          duration: null, notes: null,
        });
      }

      if (item.leaving_time) {
        activityEvents.push({
          type: "checkout", repName, customerName,
          timeDisplay: fmtTime12h(item.leaving_time),
          sortKey:     item.leaving_time,
          duration:    item.duration_minutes,
          notes: null,
        });
      }

      if (item.status === "skipped") {
        const linked = item.visit_id ? visitsById[item.visit_id] : null;
        activityEvents.push({
          type: "skip", repName, customerName,
          timeDisplay: linked ? fmtFromIso(linked.created_at) : "—",
          sortKey:     linked ? isoToLocalSortKey(linked.created_at) : "00:00:00",
          duration: null,
          notes: item.notes,
        });
      }
    }
  }

  // Off-route orders from the visits table — not tied to any schedule_item
  for (const v of visits) {
    if (v.status !== "off_route") continue;
    const repName = repById[v.rep_id]?.rep_name ?? "Unknown";
    const customerName = (v as any).customers?.customer_name ?? "Unknown";
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

  activityEvents.sort((a, b) => b.sortKey.localeCompare(a.sortKey));

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
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: A.bg, minHeight: 0, fontFamily: A.sans, color: A.ink }}>
      <PulseKeyframes />

      <PageHeader
        title="Today"
        subtitle={format(new Date(), "EEEE, d MMMM yyyy")}
        right={
          <>
            <div style={{ display: "flex", alignItems: "center", gap: 7, padding: "5px 10px", background: A.greenSoft, borderRadius: 6 }}>
              <span style={{ position: "relative", display: "inline-block", width: 6, height: 6 }}>
                <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: A.green }} />
                <span style={{ position: "absolute", inset: -2, borderRadius: 999, background: A.green, opacity: 0.25, animation: "pulseA 1.4s ease-out infinite" }} />
              </span>
              <span style={{ fontSize: 11.5, fontWeight: 600, color: A.green }}>Realtime · synced</span>
            </div>
            <ToolbarSearch placeholder="Search reps, customers…" />
          </>
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
              <div style={{ fontFamily: A.mono, fontSize: 11, color: A.inkMute }}>today · live</div>
            </div>
            {activityEvents.length === 0 ? (
              <div style={{ padding: "40px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>No activity yet today.</div>
            ) : (
              <div style={{ maxHeight: 600, overflow: "auto" }}>
                {activityEvents.map((ev, i) => <ActivityFeedRow key={i} event={ev} />)}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}