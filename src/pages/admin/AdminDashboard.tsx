import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";

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
  customers: { customer_name: string } | null;
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

/** Format a PostgreSQL time string (HH:MM or HH:MM:SS) to "10:22 AM" */
function fmtTime(t: string | null): string {
  if (!t) return "—";
  const [h, m] = t.split(":").map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
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

// ─── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  accentClass,
}: {
  label: string;
  value: string | number;
  accentClass: string;
}) {
  return (
    <div
      className={`bg-card rounded-xl shadow-sm border border-border border-l-4 ${accentClass} px-4 py-4`}
    >
      <p className="text-2xl font-bold text-foreground leading-tight">{value}</p>
      <p className="text-xs text-muted-foreground mt-1">{label}</p>
    </div>
  );
}

// ─── RepStatusCard ────────────────────────────────────────────────────────────

const STATUS_META: Record<
  RepStatus,
  { label: string; pillBg: string; pillText: string }
> = {
  checked_in:   { label: "Checked In",   pillBg: "bg-green-100", pillText: "text-green-700" },
  travelling:   { label: "Travelling",   pillBg: "bg-blue-100",  pillText: "text-blue-700"  },
  day_complete: { label: "Day Complete", pillBg: "bg-green-50",  pillText: "text-green-600" },
  not_started:  { label: "Not Started",  pillBg: "bg-gray-100",  pillText: "text-gray-500"  },
  no_schedule:  { label: "No Schedule",  pillBg: "bg-gray-50",   pillText: "text-gray-400"  },
};

function RepStatusCard({ card }: { card: RepCardData }) {
  const meta = STATUS_META[card.status];

  return (
    <div className="bg-card rounded-xl shadow-sm border border-border px-5 py-4 space-y-3">
      {/* Name + status pill */}
      <div className="flex items-start justify-between gap-2">
        <p className="font-bold text-foreground leading-snug">{card.rep.rep_name}</p>
        <span
          className={`shrink-0 text-[11px] font-semibold px-2.5 py-1 rounded-full ${meta.pillBg} ${meta.pillText}`}
        >
          {meta.label}
        </span>
      </div>

      {/* Current location (checked-in) */}
      {card.status === "checked_in" && card.currentCustomer && (
        <p className="text-xs text-muted-foreground">
          {card.currentCustomer}
          {card.currentArrivalTime ? ` since ${fmtTime(card.currentArrivalTime)}` : ""}
        </p>
      )}

      {/* No schedule */}
      {!card.hasSchedule && (
        <p className="text-xs text-muted-foreground italic">No schedule today</p>
      )}

      {/* Progress bar */}
      {card.hasSchedule && card.total > 0 && (
        <div className="space-y-1.5">
          <div className="h-1.5 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary rounded-full transition-all duration-300"
              style={{ width: `${Math.round(card.progress * 100)}%` }}
            />
          </div>
          <p className="text-[11px] text-muted-foreground">
            {card.visited + card.skipped} / {card.total} customers
          </p>
        </div>
      )}
    </div>
  );
}

// ─── ActivityRow ──────────────────────────────────────────────────────────────

function ActivityRow({ event }: { event: ActivityEvent }) {
  const textClass =
    event.type === "checkout"
      ? "text-green-700"
      : event.type === "skip"
      ? "text-destructive"
      : event.type === "offroute"
      ? "text-amber-700"
      : "text-foreground";

  let line = "";
  if (event.type === "checkin") {
    line = `${event.repName} checked in at ${event.customerName}`;
  } else if (event.type === "checkout") {
    const dur = event.duration != null ? ` (${event.duration}m)` : "";
    line = `${event.repName} checked out of ${event.customerName}${dur}`;
  } else if (event.type === "offroute") {
    line = `${event.repName} logged an off-route order at ${event.customerName}`;
  } else {
    const reason = event.notes ? ` — ${event.notes}` : "";
    line = `${event.repName} skipped ${event.customerName}${reason}`;
  }

  return (
    <div className="flex items-center justify-between px-4 py-2.5 gap-4">
      <p className={`text-sm ${textClass} flex-1 min-w-0`}>{line}</p>
      <span className="text-xs text-muted-foreground shrink-0 tabular-nums">
        {event.timeDisplay}
      </span>
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
            "id, rep_id, schedule_items(id, status, arrival_time, leaving_time, duration_minutes, notes, sort_order, customer_id, visit_id, customers(customer_name))"
          )
          .eq("schedule_date", todayStr),

        supabase
          .from("visits")
          .select("id, rep_id, customer_id, order_number, order_amount, status, created_at, customers(customer_name)")
          .eq("visit_date", todayStr)
          .neq("status", "in_progress"),
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
      return { rep, status: "no_schedule", hasSchedule: false, visited: 0, skipped: 0, total: 0, progress: 0 };
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

    return {
      rep, status, hasSchedule: true,
      visited, skipped, total,
      progress: total > 0 ? (visited + skipped) / total : 0,
      currentCustomer:    inProgressItem?.customers?.customer_name,
      currentArrivalTime: inProgressItem?.arrival_time ?? undefined,
    };
  });

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
          timeDisplay: fmtTime(item.arrival_time),
          sortKey:     item.arrival_time,
          duration: null, notes: null,
        });
      }

      if (item.leaving_time) {
        activityEvents.push({
          type: "checkout", repName, customerName,
          timeDisplay: fmtTime(item.leaving_time),
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
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center py-20">
        <p className="text-destructive text-sm">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-8">

      {/* ── Section 1: Page header ─────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-foreground">
          {format(new Date(), "EEEE, d MMMM yyyy")}
        </h1>
        <div className="flex items-center gap-2">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-500 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
          </span>
          <span className="text-sm font-medium text-green-600">Live</span>
        </div>
      </div>

      {/* ── Section 2: Summary stat strip ─────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Visits Completed" value={stats.visited}  accentClass="border-l-green-500" />
        <StatCard label="Skipped"          value={stats.skipped}  accentClass="border-l-red-500"   />
        <StatCard label="Orders Placed"    value={stats.orders}   accentClass="border-l-blue-500"  />
        <StatCard
          label="Order Value"
          value={`R\u00A0${stats.orderValue.toLocaleString("en-ZA", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}`}
          accentClass="border-l-amber-500"
        />
      </div>

      {/* ── Section 3: Rep status cards ───────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Rep Status
        </h2>
        {repCards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active reps found.</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            {repCards.map((card) => (
              <RepStatusCard key={card.rep.id} card={card} />
            ))}
          </div>
        )}
      </section>

      {/* ── Section 4: Live activity feed ─────────────────────────────────── */}
      <section>
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-widest mb-3">
          Live Activity
        </h2>
        <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
          {activityEvents.length === 0 ? (
            <p className="px-4 py-10 text-center text-muted-foreground text-sm">
              No activity yet today.
            </p>
          ) : (
            <div className="divide-y divide-border max-h-[400px] overflow-y-auto">
              {activityEvents.map((ev, idx) => (
                <ActivityRow key={idx} event={ev} />
              ))}
            </div>
          )}
        </div>
      </section>

    </div>
  );
}
