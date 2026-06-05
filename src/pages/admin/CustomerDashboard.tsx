import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TrendingUp, TrendingDown, Plus } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { ChartEntry } from "./CustomerChart";
import { fmtDuration, fmtCurrency, fmtDate } from "@/lib/timeUtils";
import { A, PageHeader, StatCard, Tag, GhostButton, PrimaryButton } from "@/lib/adminUi";

const CustomerChart = React.lazy(() => import("./CustomerChart"));

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtTime(t: string | null | undefined): string {
  if (!t) return "—";
  return t.slice(0, 5);
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function startOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

interface CustomerRow {
  id: string;
  customer_name: string;
  account_number: string | null;
  area: string | null;
}

interface VisitRow {
  id: string;
  visit_date: string;
  arrival_time: string | null;
  leaving_time: string | null;
  duration_minutes: number;
  notes: string | null;
  status: string;
  order_number: string | null;
  order_quantity: number | null;
  order_amount: number | null;
}

// ─── CustomerDashboard ────────────────────────────────────────────────────────

export default function CustomerDashboard() {
  const { customerId } = useParams<{ customerId: string }>();
  const navigate = useNavigate();

  const [customer, setCustomer] = useState<CustomerRow | null>(null);
  const [repName, setRepName] = useState<string>("—");
  const [visits, setVisits] = useState<VisitRow[]>([]);
  const [loading, setLoading] = useState(true);

  // date range state — default "all time"
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (!customerId) return;
    const load = async () => {
      setLoading(true);

      const [custRes, visitsRes, assignRes] = await Promise.all([
        supabase.from("customers").select("id, customer_name, account_number, area").eq("id", customerId).maybeSingle(),
        (supabase.from("visits").select("id, visit_date, arrival_time, leaving_time, duration_minutes, notes, status, order_number, order_quantity, order_amount").eq("customer_id", customerId).neq("status", "in_progress").eq("is_deleted", false) as any).order("visit_date", { ascending: false }).order("arrival_time", { ascending: false }),
        supabase.from("customer_assignments").select("rep_id").eq("customer_id", customerId).maybeSingle(),
      ]);

      setCustomer(custRes.data || null);
      setVisits(visitsRes.data || []);

      if (assignRes.data?.rep_id) {
        const repRes = await supabase.from("reps").select("rep_name, surname").eq("id", assignRes.data.rep_id).maybeSingle();
        if (repRes.data) {
          setRepName(`${repRes.data.rep_name}${repRes.data.surname ? " " + repRes.data.surname : ""}`);
        }
      }

      setLoading(false);
    };
    load();
  }, [customerId]);

  // ── date-filtered visits ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return visits.filter((v) => {
      if (fromDate && v.visit_date < fromDate) return false;
      if (toDate && v.visit_date > toDate) return false;
      return true;
    });
  }, [visits, fromDate, toDate]);

  // ── metrics ───────────────────────────────────────────────────────────────
  const metrics = useMemo(() => {
    // visitActive: actual physical visits — excludes skipped AND off_route.
    // Used for visit count, strike rate, and average time.
    const visitActive = filtered.filter((v) => v.status !== "skipped" && v.status !== "off_route");

    // orderActive: all rows that could carry real orders — excludes skipped only.
    // Off_route orders are real and count toward revenue / avg order value.
    const orderActive = filtered.filter((v) => v.status !== "skipped");

    const totalVisits = visitActive.length;

    // Strike rate: orders placed during actual scheduled visits only.
    const visitOrders = visitActive.filter(
      (v) => v.order_number != null || (v.order_quantity != null && v.order_quantity > 0)
    );
    const strikeRate =
      totalVisits > 0 ? ((visitOrders.length / totalVisits) * 100).toFixed(1) + "%" : "—";

    // Order totals include off_route.
    const orderEligible = orderActive.filter(
      (v) => v.order_number != null || (v.order_quantity != null && v.order_quantity > 0)
    );
    const totalOrders = orderEligible.length;

    const totalQty = orderActive.reduce((sum, v) => sum + (v.order_quantity ?? 0), 0);
    const totalRevenue = orderActive.reduce((sum, v) => sum + (v.order_amount ?? 0), 0);

    const avgOrderValue =
      totalOrders > 0 ? fmtCurrency(totalRevenue / totalOrders) : "—";

    // Duration is only meaningful for physical visits.
    const visitsWithDuration = visitActive.filter((v) => v.duration_minutes > 0);
    const avgDuration =
      visitsWithDuration.length > 0
        ? fmtDuration(
            Math.round(
              visitsWithDuration.reduce((s, v) => s + v.duration_minutes, 0) /
                visitsWithDuration.length
            )
          )
        : "—";

    // Trend: compare avg order value of recent vs older order-eligible rows (includes off_route).
    let trend: React.ReactNode = null;
    if (orderEligible.length >= 4) {
      const half = Math.floor(orderEligible.length / 2);
      // visits are sorted newest first
      const recentHalf = orderEligible.slice(0, half);
      const olderHalf  = orderEligible.slice(half);
      const recentAvg  = recentHalf.reduce((s, v) => s + (v.order_amount ?? 0), 0) / recentHalf.length;
      const olderAvg   = olderHalf.reduce((s, v) => s + (v.order_amount ?? 0), 0) / olderHalf.length;
      if (olderAvg > 0) {
        const pct = (((recentAvg - olderAvg) / olderAvg) * 100).toFixed(1);
        const up = recentAvg >= olderAvg;
        trend = (
          <span
            className={`flex items-center gap-1 text-xs font-medium ${up ? "text-green-600" : "text-red-600"}`}
          >
            {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
            {up ? "+" : ""}{pct}%
          </span>
        );
      }
    }

    return { totalVisits, totalOrders, strikeRate, totalQty, totalRevenue, avgOrderValue, avgDuration, trend };
  }, [filtered]);

  // ── quick-select helpers ──────────────────────────────────────────────────
  const applyRange = (from: string, to: string) => {
    setFromDate(from);
    setToDate(to);
  };

  // ── chart data ────────────────────────────────────────────────────────────
  const chartData = useMemo(() => {
    return [...filtered].reverse().map((v) => ({
      id: v.id,
      date: v.visit_date,
      status: v.status,
      displayAmount: v.order_amount ?? 0,
      // Use a tiny sentinel so skipped bars still render a sliver on the axis
      amount: v.status === "skipped" ? 0.001 : (v.order_amount ?? 0),
      label: format(parseISO(v.visit_date), "dd MMM"),
    }));
  }, [filtered]);

  const nonSkippedCount = useMemo(
    () => filtered.filter((v) => v.status !== "skipped").length,
    [filtered]
  );
  const showChart = nonSkippedCount >= 2;

  // ── row highlight ─────────────────────────────────────────────────────────
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  const handleBarClick = useCallback((barData: ChartEntry) => {
    const id = barData?.id;
    if (!id) return;
    setHighlightedId(id);
    const row = document.getElementById(`visit-row-${id}`);
    if (row) row.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => setHighlightedId(null), 1500);
  }, []);

  if (loading) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: A.bg }}>
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!customer) {
    return (
      <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", background: A.bg, fontFamily: A.sans, color: A.inkMute, fontSize: 13 }}>
        Customer not found.
      </div>
    );
  }

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: A.bg, minHeight: 0, fontFamily: A.sans, color: A.ink }}>
      <PageHeader
        breadcrumb={[
          <button
            key="customers-link"
            type="button"
            onClick={() => navigate("/admin/customers")}
            style={{ background: "transparent", border: "none", padding: 0, color: A.inkSoft, fontFamily: A.sans, fontSize: 11.5, cursor: "pointer" }}
          >
            Customers
          </button>,
          customer.customer_name,
        ]}
        title={customer.customer_name}
        subtitle={
          <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
            {customer.account_number && <span style={{ fontFamily: A.mono }}>#{customer.account_number}</span>}
            {customer.account_number && (customer.area || repName) && <span style={{ color: A.inkDim }}>·</span>}
            {customer.area && <span>{customer.area}</span>}
            {customer.area && repName && <span style={{ color: A.inkDim }}>·</span>}
            <span>Rep: {repName}</span>
          </span>
        }
        right={
          <>
            {/* Date range pills */}
            <div style={{ display: "flex", alignItems: "center", gap: 4, padding: 4, background: A.borderSoft, borderRadius: 7 }}>
              {(
                [
                  { label: "7d",    from: daysAgo(7),       to: today() },
                  { label: "30d",   from: daysAgo(30),      to: today() },
                  { label: "Month", from: startOfMonth(),   to: today() },
                  { label: "All",   from: "",                to: "" },
                ] as const
              ).map((opt) => {
                const isActive = fromDate === opt.from && toDate === opt.to;
                return (
                  <button
                    key={opt.label}
                    type="button"
                    onClick={() => applyRange(opt.from, opt.to)}
                    style={{ padding: "4px 11px", borderRadius: 5, fontFamily: A.sans, fontSize: 11.5, fontWeight: 500, color: isActive ? A.ink : A.inkSoft, background: isActive ? A.panel : "transparent", boxShadow: isActive ? "0 1px 2px rgba(23,23,21,0.06)" : "none", border: "none", cursor: "pointer" }}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </>
        }
      />

      <div style={{ padding: "18px 24px", overflow: "auto", flex: 1 }}>
        {/* Custom date range — sits beneath the page header, only shown when one of the quick ranges isn't active */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div style={{ fontSize: 11, color: A.inkMute, fontWeight: 600, letterSpacing: 0.3, textTransform: "uppercase" }}>Custom range:</div>
          <Label className="sr-only" htmlFor="cd-from">From</Label>
          <Input id="cd-from" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} style={{ width: 150, height: 30, fontSize: 12, fontFamily: A.mono, background: A.panel, borderColor: A.border }} />
          <span style={{ color: A.inkDim, fontSize: 12 }}>→</span>
          <Label className="sr-only" htmlFor="cd-to">To</Label>
          <Input id="cd-to" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} style={{ width: 150, height: 30, fontSize: 12, fontFamily: A.mono, background: A.panel, borderColor: A.border }} />
          {(fromDate || toDate) && (
            <GhostButton onClick={() => applyRange("", "")}>Clear</GhostButton>
          )}
          <div style={{ flex: 1 }} />
          <PrimaryButton icon={<Plus size={13} />}>Log visit</PrimaryButton>
        </div>

        {/* 8-tile metric grid */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
          <StatCard label="Total visits"          value={metrics.totalVisits} />
          <StatCard label="Total orders"          value={metrics.totalOrders} />
          <StatCard label="Strike rate"           value={metrics.strikeRate} accent={A.green} />
          <StatCard label="Avg time / visit"      value={metrics.avgDuration} />
          <StatCard label="Total qty sold"        value={metrics.totalQty} />
          <StatCard label="Total revenue"         value={fmtCurrency(metrics.totalRevenue)} accent={A.green} />
          <StatCard label="Avg order value"       value={metrics.avgOrderValue} sub={metrics.trend} />
          <StatCard label="Visit window"          value={fromDate && toDate ? `${fromDate.slice(5).replace("-", "/")} → ${toDate.slice(5).replace("-", "/")}` : fromDate ? `from ${fromDate}` : toDate ? `until ${toDate}` : "All time"} mono={false} />
        </div>

        {/* Order value chart */}
        <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, padding: "14px 18px 18px", marginBottom: 14 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
            <div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>Order value by visit</div>
              <div style={{ fontSize: 11.5, color: A.inkMute, marginTop: 2 }}>Chronological — newest on the right · click a bar to jump to the row</div>
            </div>
            <div style={{ display: "flex", gap: 14, fontSize: 11, color: A.inkMute }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 9, height: 9, background: A.green, borderRadius: 2 }} /> Order
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 9, height: 9, background: A.sun, borderRadius: 2 }} /> Off-route
              </span>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
                <span style={{ width: 9, height: 9, background: A.danger, borderRadius: 2 }} /> Skipped
              </span>
            </div>
          </div>
          {showChart ? (
            <Suspense fallback={<div style={{ height: 250, background: A.borderSoft, borderRadius: 6, animation: "pulse 1.5s ease-in-out infinite" }} />}>
              <CustomerChart data={chartData as ChartEntry[]} onBarClick={handleBarClick} />
            </Suspense>
          ) : (
            <div style={{ padding: "32px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>Not enough visit data to display a chart.</div>
          )}
        </div>

        {/* Visit history table */}
        <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: `1px solid ${A.border}` }}>
            <div style={{ fontSize: 13, fontWeight: 600 }}>Visit history</div>
            <div style={{ fontFamily: A.mono, fontSize: 11, color: A.inkMute }}>{filtered.length} {filtered.length === 1 ? "visit" : "visits"}</div>
          </div>

          {filtered.length === 0 ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>No visits in this date range.</div>
          ) : (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.6fr 0.6fr 0.6fr 0.7fr 0.4fr 0.8fr 1.4fr", padding: "8px 16px", fontSize: 10.5, color: A.inkMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", borderBottom: `1px solid ${A.borderSoft}` }}>
                <div>Date</div>
                <div>Arr</div>
                <div>Dep</div>
                <div>Duration</div>
                <div>Order №</div>
                <div>Qty</div>
                <div style={{ textAlign: "right" }}>Amount</div>
                <div>Notes</div>
              </div>
              {filtered.map((v, i) => {
                const isSkipped  = v.status === "skipped";
                const isOffRoute = v.status === "off_route";
                const isHighlighted = highlightedId === v.id;
                return (
                  <div
                    key={v.id}
                    id={`visit-row-${v.id}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "1.1fr 0.6fr 0.6fr 0.6fr 0.7fr 0.4fr 0.8fr 1.4fr",
                      padding: "10px 16px",
                      alignItems: "center",
                      borderBottom: i < filtered.length - 1 ? `1px solid ${A.borderRow}` : "none",
                      fontSize: 12,
                      color: isSkipped ? A.danger : A.ink,
                      background: isSkipped ? A.dangerBg : isHighlighted ? A.greenSoft : "transparent",
                      transition: "background 0.3s",
                    }}
                  >
                    <div style={{ fontWeight: 500, display: "flex", alignItems: "center", gap: 6 }}>
                      {v.visit_date}
                      {isSkipped && <Tag tone="danger">SKIP</Tag>}
                      {isOffRoute && <Tag tone="sun">OFF-ROUTE</Tag>}
                    </div>
                    <div style={{ fontFamily: A.mono, fontSize: 11.5 }}>{isOffRoute ? "" : fmtTime(v.arrival_time)}</div>
                    <div style={{ fontFamily: A.mono, fontSize: 11.5 }}>{isOffRoute ? "" : fmtTime(v.leaving_time)}</div>
                    <div style={{ fontFamily: A.mono, fontSize: 11.5 }}>{isOffRoute ? "—" : v.duration_minutes > 0 ? fmtDuration(v.duration_minutes) : "—"}</div>
                    <div style={{ fontFamily: A.mono, fontSize: 11.5 }}>{v.order_number || "—"}</div>
                    <div style={{ fontFamily: A.mono, fontSize: 11.5 }}>{v.order_quantity ?? "—"}</div>
                    <div style={{ fontFamily: A.mono, fontSize: 11.5, textAlign: "right" }}>
                      {v.order_amount != null ? fmtCurrency(Number(v.order_amount)) : "—"}
                    </div>
                    <div style={{ fontSize: 11.5, color: A.inkMute, fontStyle: v.notes ? "italic" : "normal", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{v.notes || "—"}</div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </div>
  );
}