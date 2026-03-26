import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ArrowLeft, TrendingUp, TrendingDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { format, parseISO } from "date-fns";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtTime(t: string | null | undefined): string {
  if (!t) return "—";
  return t.slice(0, 5);
}

function fmtCurrency(n: number): string {
  return "R " + n.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDuration(mins: number): string {
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
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

// ─── ChartTooltip ─────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="bg-background border rounded-lg shadow-sm px-3 py-2 text-sm space-y-0.5">
      <p className="font-medium">{format(parseISO(d.date), "dd MMM yyyy")}</p>
      <p className="text-muted-foreground capitalize">{d.status}</p>
      <p>{d.displayAmount > 0 ? fmtCurrency(d.displayAmount) : "No order"}</p>
    </div>
  );
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

  const [customer, setCustomer] = useState<any>(null);
  const [repName, setRepName] = useState<string>("—");
  const [visits, setVisits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // date range state — default "all time"
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    if (!customerId) return;
    const load = async () => {
      setLoading(true);

      const [custRes, visitsRes, assignRes] = await Promise.all([
        supabase.from("customers").select("*").eq("id", customerId).maybeSingle(),
        supabase.from("visits").select("*").eq("customer_id", customerId).order("visit_date", { ascending: false }).order("arrival_time", { ascending: false }),
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
    const active = filtered.filter((v) => v.status !== "skipped");

    const totalVisits = active.length;

    const orderVisits = active.filter(
      (v) => v.order_number != null || (v.order_quantity != null && v.order_quantity > 0)
    );
    const totalOrders = orderVisits.length;

    const strikeRate =
      totalVisits > 0 ? ((totalOrders / totalVisits) * 100).toFixed(1) + "%" : "—";

    const totalQty = active.reduce((sum, v) => sum + (v.order_quantity ?? 0), 0);

    const totalRevenue = active.reduce((sum, v) => sum + (v.order_amount ?? 0), 0);

    const avgOrderValue =
      totalOrders > 0 ? fmtCurrency(totalRevenue / totalOrders) : "—";

    const visitsWithDuration = active.filter((v) => v.duration_minutes > 0);
    const avgDuration =
      visitsWithDuration.length > 0
        ? fmtDuration(
            Math.round(
              visitsWithDuration.reduce((s, v) => s + v.duration_minutes, 0) /
                visitsWithDuration.length
            )
          )
        : "—";

    // trend: compare avg order value of recent half vs older half
    let trend: React.ReactNode = null;
    if (orderVisits.length >= 4) {
      const half = Math.floor(orderVisits.length / 2);
      // visits are sorted newest first
      const recentHalf = orderVisits.slice(0, half);
      const olderHalf = orderVisits.slice(half);
      const recentAvg =
        recentHalf.reduce((s, v) => s + (v.order_amount ?? 0), 0) / recentHalf.length;
      const olderAvg =
        olderHalf.reduce((s, v) => s + (v.order_amount ?? 0), 0) / olderHalf.length;
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

  const handleBarClick = useCallback((barData: any) => {
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
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={chartData} onClick={(e) => e?.activePayload?.[0] && handleBarClick(e.activePayload[0].payload)}>
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis tickFormatter={(v) => `R ${v.toLocaleString("en-ZA")}`} tick={{ fontSize: 11 }} width={72} />
                <Tooltip content={<ChartTooltip />} />
                <Bar dataKey="amount" minPointSize={2} cursor="pointer">
                  {chartData.map((entry) => (
                    <Cell
                      key={entry.id}
                      fill={
                        entry.status === "skipped"
                          ? "#ef4444"
                          : entry.displayAmount > 0
                          ? "#22c55e"
                          : "#f59e0b"
                      }
                    />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
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
                  const isSkipped = v.status === "skipped";
                  const hasOrder = v.order_number != null || (v.order_quantity != null && v.order_quantity > 0);
                  const rowClass = [
                    isSkipped ? "bg-red-50" : !hasOrder ? "text-muted-foreground" : "",
                    highlightedId === v.id ? "ring-2 ring-inset ring-green-500" : "",
                  ].filter(Boolean).join(" ");
                  return (
                    <TableRow key={v.id} id={`visit-row-${v.id}`} className={rowClass}>
                      <TableCell className="font-medium whitespace-nowrap">{v.visit_date}</TableCell>
                      <TableCell>{fmtTime(v.arrival_time)}</TableCell>
                      <TableCell>{fmtTime(v.leaving_time)}</TableCell>
                      <TableCell>{v.duration_minutes > 0 ? fmtDuration(v.duration_minutes) : "—"}</TableCell>
                      <TableCell>{v.order_number || "—"}</TableCell>
                      <TableCell>{v.order_quantity ?? "—"}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        {v.order_amount != null ? fmtCurrency(Number(v.order_amount)) : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs text-xs">
                        {isSkipped && <span className="font-semibold text-red-600 mr-1">[SKIPPED]</span>}
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
