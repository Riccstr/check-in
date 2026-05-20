import React, { useState, useEffect, useMemo, useCallback, Suspense } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
import { format, parseISO } from "date-fns";
import type { ChartEntry } from "./CustomerChart";
import { fmtDuration, fmtCurrency, fmtDate } from "@/lib/timeUtils";

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

// ─── MetricCard ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  trend,
}: {
  label: string;
  value: string;
  trend?: React.ReactNode;
}) {
  return (
    <Card className="rounded-xl">
      <CardContent className="pt-5 pb-4 px-5">
        <p className="text-xs font-medium text-muted-foreground mb-1">{label}</p>
        <p className="text-2xl font-bold leading-none">{value}</p>
        {trend && <div className="mt-2">{trend}</div>}
      </CardContent>
    </Card>
  );
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
    return <div className="p-8 text-muted-foreground">Loading...</div>;
  }

  if (!customer) {
    return <div className="p-8 text-muted-foreground">Customer not found.</div>;
  }

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-5">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate("/admin/customers")} className="mt-0.5 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold leading-tight">{customer.customer_name}</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {customer.account_number && <span>#{customer.account_number}</span>}
            {customer.account_number && customer.area && <span className="mx-1.5">·</span>}
            {customer.area && <span>{customer.area}</span>}
            {(customer.account_number || customer.area) && <span className="mx-1.5">·</span>}
            <span>Rep: {repName}</span>
          </p>
        </div>
      </div>

      {/* Date range filter */}
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="h-8 text-sm w-36" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="h-8 text-sm w-36" />
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <Button variant="outline" size="sm" onClick={() => applyRange(daysAgo(7), today())}>Last 7 days</Button>
          <Button variant="outline" size="sm" onClick={() => applyRange(daysAgo(30), today())}>Last 30 days</Button>
          <Button variant="outline" size="sm" onClick={() => applyRange(startOfMonth(), today())}>This month</Button>
          <Button variant="outline" size="sm" onClick={() => applyRange("", "")}>All time</Button>
        </div>
      </div>

      {/* Metric cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <MetricCard label="Total Visits" value={String(metrics.totalVisits)} />
        <MetricCard label="Total Orders" value={String(metrics.totalOrders)} />
        <MetricCard label="Strike Rate" value={metrics.strikeRate} />
        <MetricCard label="Total Qty Sold" value={String(metrics.totalQty)} />
        <MetricCard label="Total Revenue" value={fmtCurrency(metrics.totalRevenue)} />
        <MetricCard label="Avg Order Value" value={metrics.avgOrderValue} trend={metrics.trend} />
        <MetricCard label="Avg Time per Visit" value={metrics.avgDuration} />
      </div>

      {/* Order value chart */}
      <Card className="rounded-xl">
        <CardContent className="pt-5 pb-4 px-5">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3">Order Value by Visit</p>
          {showChart ? (
            <Suspense fallback={<div className="h-[250px] animate-pulse bg-muted rounded" />}>
              <CustomerChart data={chartData as ChartEntry[]} onBarClick={handleBarClick} />
            </Suspense>
          ) : (
            <p className="text-sm text-muted-foreground py-6 text-center">Not enough visit data to display a chart.</p>
          )}
        </CardContent>
      </Card>

      {/* Visit history table */}
      <div>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Visit History</h2>
        {filtered.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No visits in this date range.</p>
        ) : (
          <div className="border rounded-xl overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Arrival</TableHead>
                  <TableHead>Departure</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Order No.</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((v) => {
                  const isSkipped  = v.status === "skipped";
                  const isOffRoute = v.status === "off_route";
                  const hasOrder = v.order_number != null || (v.order_quantity != null && v.order_quantity > 0);
                  const rowClass = [
                    isSkipped ? "bg-red-50" : !hasOrder && !isOffRoute ? "text-muted-foreground" : "",
                    highlightedId === v.id ? "ring-2 ring-inset ring-green-500" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <TableRow key={v.id} id={`visit-row-${v.id}`} className={rowClass}>
                      <TableCell className="font-medium whitespace-nowrap">{v.visit_date}</TableCell>
                      <TableCell>{isOffRoute ? "" : fmtTime(v.arrival_time)}</TableCell>
                      <TableCell>{isOffRoute ? "" : fmtTime(v.leaving_time)}</TableCell>
                      <TableCell>{isOffRoute ? "—" : (v.duration_minutes > 0 ? fmtDuration(v.duration_minutes) : "—")}</TableCell>
                      <TableCell>{v.order_number || "—"}</TableCell>
                      <TableCell>{v.order_quantity ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {v.order_amount != null ? fmtCurrency(Number(v.order_amount)) : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs">
                        {isSkipped  && <span className="font-semibold text-red-600 mr-1">[SKIPPED]</span>}
                        {isOffRoute && <span className="font-semibold text-amber-600 mr-1">[OFF-ROUTE]</span>}
                        {v.notes || ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
