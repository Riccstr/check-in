import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Pencil, Trash2, Camera } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { A, PageHeader, Tag } from "@/lib/adminUi";

const PAGE_SIZE = 50;

interface VisitRep {
  rep_name: string;
}

interface VisitCustomer {
  customer_name: string;
  account_number: string | null;
}

interface Visit {
  id: string;
  rep_id: string;
  customer_id: string;
  visit_date: string;
  arrival_time: string | null;
  leaving_time: string | null;
  duration_minutes: number | null;
  notes: string | null;
  status: string;
  order_number: string | null;
  order_quantity: number | null;
  order_amount: number | null;
  photo_url: string | null;
  is_deleted: boolean;
  client_generated_id: string | null;
  created_at: string;
  latitude: number | null;
  longitude: number | null;
  location_address: string | null;
  reps: VisitRep | null;
  customers: VisitCustomer | null;
}

interface RepOption {
  id: string;
  rep_name: string;
}

interface CustomerOption {
  id: string;
  customer_name: string;
  area: string | null;
}

export default function AdminVisits() {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [reps, setReps] = useState<RepOption[]>([]);
  const [customers, setCustomers] = useState<CustomerOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [repFilter, setRepFilter] = useState("all");
  const [custFilter, setCustFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editVisit, setEditVisit] = useState<Visit | null>(null);
  const [editArrival, setEditArrival] = useState("");
  const [editLeaving, setEditLeaving] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editOrderNumber, setEditOrderNumber] = useState("");
  const [editOrderQty, setEditOrderQty] = useState("");
  const [editOrderAmount, setEditOrderAmount] = useState("");
  const [photoModal, setPhotoModal] = useState<Visit | null>(null);
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [summaryStats, setSummaryStats] = useState({ totalVisits: 0, completedCount: 0, skippedCount: 0, offRouteCount: 0, totalAmount: 0 });

  const fetchVisits = async () => {
    setLoading(true);

    // Build base filter for reuse in both queries
    const applyFilters = (q: any) => {
      q = q.eq("is_deleted", false);
      if (repFilter !== "all") q = q.eq("rep_id", repFilter);
      if (custFilter !== "all") q = q.eq("customer_id", custFilter);
      if (dateFrom) q = q.gte("visit_date", dateFrom);
      if (dateTo) q = q.lte("visit_date", dateTo);
      return q;
    };

    // Paginated data query
    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;
    const dataQuery = applyFilters(
      supabase
        .from("visits")
        .select("*, reps(rep_name), customers(customer_name, account_number)", { count: "exact" })
        .order("visit_date", { ascending: false })
        .order("arrival_time", { ascending: false })
        .range(from, to)
    );

    // Summary stats query — fetches only the fields needed for aggregation, no limit
    const statsQuery = applyFilters(
      (supabase as any)
        .from("visits")
        .select("status, order_amount")
    );

    const [{ data, count }, { data: statsData }] = await Promise.all([dataQuery, statsQuery]);

    setVisits((data as Visit[]) || []);
    setTotalCount(count ?? 0);

    // Compute summary stats from full result set
    const allVisits = (statsData as any[]) || [];
    setSummaryStats({
      totalVisits: allVisits.length,
      completedCount: allVisits.filter((v) => v.status === "visited").length,
      skippedCount: allVisits.filter((v) => v.status === "skipped").length,
      offRouteCount: allVisits.filter((v) => v.status === "off_route").length,
      totalAmount: allVisits.reduce((s: number, v: any) => s + (Number(v.order_amount) || 0), 0),
    });

    setLoading(false);
  };

  useEffect(() => {
    Promise.all([
      supabase.from("reps").select("id, rep_name").order("rep_name"),
      supabase.from("customers").select("id, customer_name, area").order("customer_name"),
    ]).then(([r, c]) => { setReps(r.data || []); setCustomers(c.data || []); });
  }, []);

  useEffect(() => { setPage(0); }, [repFilter, custFilter, dateFrom, dateTo]);
  useEffect(() => { fetchVisits(); }, [repFilter, custFilter, dateFrom, dateTo, page]);

  // Keep a ref to the latest fetchVisits so the realtime callback always uses
  // the current filter state without needing to recreate the channel.
  const fetchVisitsRef = useRef(fetchVisits);
  fetchVisitsRef.current = fetchVisits;

  useEffect(() => {
    const channel = supabase
      .channel("admin-visits-realtime")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "visits" }, () => {
        fetchVisitsRef.current();
      })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "visits" }, () => {
        fetchVisitsRef.current();
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const del = async (id: string) => {
    if (!confirm("Delete this visit?")) return;
    const { error } = await supabase.from("visits").update({ is_deleted: true } as any).eq("id", id);
    if (error) { toast.error("Failed to delete: " + error.message); return; }
    toast.success("Deleted"); fetchVisits();
  };

  const openEdit = (v: any) => { setEditVisit(v); setEditArrival(v.arrival_time); setEditLeaving(v.leaving_time); setEditNotes(v.notes || ""); setEditDate(v.visit_date); setEditOrderNumber(v.order_number || ""); setEditOrderQty(v.order_quantity != null ? String(v.order_quantity) : ""); setEditOrderAmount(v.order_amount != null ? String(v.order_amount) : ""); };

  const saveEdit = async () => {
    const [ah, am] = editArrival.split(":").map(Number);
    const [lh, lm] = editLeaving.split(":").map(Number);
    const dur = (lh * 60 + lm) - (ah * 60 + am);
    if (dur <= 0) { toast.error("Invalid times"); return; }
    await supabase.from("visits").update({
      arrival_time: editArrival,
      leaving_time: editLeaving,
      duration_minutes: dur,
      notes: editNotes || null,
      visit_date: editDate,
      order_number: editOrderNumber || null,
      order_quantity: editOrderQty !== "" ? Number(editOrderQty) : null,
      order_amount: editOrderAmount !== "" ? Number(editOrderAmount) : null,
    }).eq("id", editVisit.id);

    // Also patch the linked schedule_item so the rep's app reflects the change
    // via its realtime subscription on schedule_items.
    try {
      await supabase
        .from("schedule_items")
        .update({
          arrival_time: editArrival,
          leaving_time: editLeaving,
          duration_minutes: dur,
          notes: editNotes || null,
        })
        .eq("visit_id", editVisit.id);
    } catch { /* non-fatal — visit row already updated */ }

    toast.success("Updated"); setEditVisit(null); fetchVisits();
  };

  const renderTime = (v: Visit) => {
    if (v.status === "skipped" || v.status === "off_route") {
      return <span style={{ color: A.inkMute }}>—</span>;
    }
    const arr = v.arrival_time?.slice(0, 5);
    const lev = v.leaving_time?.slice(0, 5);
    if (arr && lev) {
      return (
        <span style={{ fontFamily: A.mono, fontSize: 11.5, whiteSpace: "nowrap" }}>
          {arr} – {lev}
          {v.duration_minutes != null && <span style={{ color: A.inkMute }}> ({v.duration_minutes}m)</span>}
        </span>
      );
    }
    if (arr) return <span style={{ fontFamily: A.mono, fontSize: 11.5, whiteSpace: "nowrap" }}>{arr} –</span>;
    return <span style={{ color: A.inkMute }}>—</span>;
  };

  const renderPhoto = (v: Visit) => {
    if (v.photo_url) {
      return (
        <button
          type="button"
          onClick={() => setPhotoModal(v)}
          style={{ display: "block", width: 36, height: 36, borderRadius: 5, overflow: "hidden", border: `1px solid ${A.border}`, padding: 0, background: "transparent", cursor: "pointer" }}
          title="View photo"
        >
          <img src={v.photo_url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        </button>
      );
    }
    if (v.status === "off_route") return <Tag tone="sun">Off-route</Tag>;
    if (v.status === "skipped") return <Tag tone="danger">Skipped</Tag>;
    return <span style={{ color: A.inkMute }}>—</span>;
  };

  const hasFilters = repFilter !== "all" || custFilter !== "all" || !!dateFrom || !!dateTo;

  const GRID_COLS = "75px 0.8fr 1.1fr 0.8fr 65px 0.9fr 10px 0.6fr 2.2fr 60px";

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: A.bg, minHeight: 0, fontFamily: A.sans, color: A.ink }}>
      <PageHeader
        title="Visits"
        subtitle="Every check-in, check-out, skip and off-route across all reps"
      />

      {/* Filter strip */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", background: A.panel, borderBottom: `1px solid ${A.border}`, flexShrink: 0, flexWrap: "wrap" }}>
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: A.inkMute, fontWeight: 500 }}>Rep:</span>
          <SearchableSelect
            value={repFilter}
            onValueChange={setRepFilter}
            options={reps.map((r) => ({ value: r.id, label: r.rep_name }))}
            placeholder="All reps"
            searchPlaceholder="Search reps…"
            includeAll
            allLabel="All reps"
            className="w-44"
          />
        </div>
        <div style={{ width: 1, height: 22, background: A.borderSoft }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: 11.5, color: A.inkMute, fontWeight: 500 }}>Customer:</span>
          <SearchableSelect
            value={custFilter}
            onValueChange={setCustFilter}
            options={customers.map((c) => ({ value: c.id, label: c.customer_name + (c.area ? ` (${c.area})` : "") }))}
            placeholder="All customers"
            searchPlaceholder="Search customers…"
            includeAll
            allLabel="All customers"
            className="w-52"
          />
        </div>
        <div style={{ width: 1, height: 22, background: A.borderSoft }} />
        <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <Label htmlFor="visits-from" className="text-xs" style={{ color: A.inkMute, fontWeight: 500 }}>From</Label>
          <Input id="visits-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} style={{ width: 140, height: 32, fontSize: 12, fontFamily: A.mono, background: A.panel, borderColor: A.border }} />
          <Label htmlFor="visits-to" className="text-xs" style={{ color: A.inkMute, fontWeight: 500 }}>To</Label>
          <Input id="visits-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} style={{ width: 140, height: 32, fontSize: 12, fontFamily: A.mono, background: A.panel, borderColor: A.border }} />
        </div>

        {hasFilters && (
          <button
            type="button"
            onClick={() => { setRepFilter("all"); setCustFilter("all"); setDateFrom(""); setDateTo(""); }}
            style={{ fontSize: 11.5, color: A.inkMute, background: "transparent", border: "none", cursor: "pointer", padding: "5px 8px", fontFamily: A.sans }}
          >
            Clear filters
          </button>
        )}

        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11.5, color: A.inkMute }}>{totalCount} {totalCount === 1 ? "result" : "results"}</div>
      </div>

      {/* Summary strip */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 0, background: A.panel, borderBottom: `1px solid ${A.border}`, padding: "14px 24px", flexShrink: 0 }}>
        {[
          { l: "Total visits",   v: summaryStats.totalVisits,  sub: undefined as string | undefined, accent: undefined as string | undefined },
          { l: "Completed",      v: summaryStats.completedCount, sub: `${(summaryStats.totalVisits > 0 ? Math.round((summaryStats.completedCount / summaryStats.totalVisits) * 100) : 0)}%`, accent: A.green },
          { l: "Skipped",        v: summaryStats.skippedCount,   sub: undefined, accent: A.danger },
          { l: "Off-route",      v: summaryStats.offRouteCount,  sub: undefined, accent: A.sun },
          { l: "Order value",    v: `R\u00A0${summaryStats.totalAmount.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, sub: undefined, accent: A.green },
        ].map((s, i) => (
          <div key={s.l} style={{ paddingLeft: i > 0 ? 18 : 0, borderLeft: i > 0 ? `1px solid ${A.borderSoft}` : "none" }}>
            <div style={{ fontSize: 10.5, color: A.inkMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase" }}>{s.l}</div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 4 }}>
              <div style={{ fontFamily: A.mono, fontSize: 19, fontWeight: 600, color: A.ink, letterSpacing: -0.3, lineHeight: 1, fontVariantNumeric: "tabular-nums" }}>{s.v}</div>
              {s.sub && <div style={{ fontSize: 11, color: s.accent || A.inkMute, fontWeight: 500 }}>{s.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ flex: 1, overflow: "auto", padding: "0 24px 14px 24px" }}>
        {loading ? (
          <div style={{ padding: "60px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>Loading…</div>
        ) : (
          <div style={{ marginTop: 14 }}>
            {/* Sticky header — sits directly in the scroll container */}
            <div style={{ display: "grid", gridTemplateColumns: GRID_COLS, padding: "8px 14px", fontSize: 10.5, color: A.inkMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", borderBottom: `1px solid ${A.borderSoft}`, background: A.panelTint, border: `1px solid ${A.border}`, borderRadius: "10px 10px 0 0", position: "sticky", top: 0, zIndex: 1 }}>
              <div>Date</div>
              <div>Rep</div>
              <div>Customer</div>
              <div style={{ paddingLeft: 18 }}>Time</div>
              <div style={{ textAlign: "center" }}><Camera size={12} style={{ display: "inline-block", verticalAlign: "-2px" }} /></div>
              <div style={{ paddingLeft: 72, paddingRight: 0 }}>Order №</div>
              <div style={{ textAlign: "center" }}>Qty</div>
              <div style={{ textAlign: "right" }}>Amount</div>
              <div style={{ paddingLeft: 80 }}>Notes</div>
              <div></div>
            </div>

            {/* Body */}
            <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderTop: "none", borderRadius: "0 0 10px 10px", overflow: "hidden" }}>
              {visits.length === 0 ? (
              <div style={{ padding: "40px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>
                {hasFilters ? "No visits match your filters." : "No visits yet."}
              </div>
            ) : visits.map((v: any, i: number) => {
              const isSkipped = v.status === "skipped";
              return (
                <div
                  key={v.id}
                  style={{
                    display: "grid",
                    gridTemplateColumns: GRID_COLS,
                    padding: "7px 14px",
                    alignItems: "center",
                    borderBottom: i < visits.length - 1 ? `1px solid ${A.borderRow}` : "none",
                    fontSize: 13,
                    color: isSkipped ? A.danger : A.ink,
                    background: isSkipped ? A.dangerBg : "transparent",
                  }}
                >
                  <div style={{ fontFamily: A.mono, fontSize: 11, color: isSkipped ? A.danger : A.inkSoft }}>{v.visit_date}</div>
                  <div style={{ fontWeight: 500 }}>{v.reps?.rep_name || "—"}</div>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 500 }}>{v.customers?.customer_name}</span>
                    </div>
                    {v.customers?.account_number && (
                      <div style={{ fontSize: 10.5, color: A.inkMute, fontFamily: A.mono, marginTop: 1 }}>#{v.customers.account_number}</div>
                    )}
                  </div>
                  <div style={{ paddingLeft: 18 }}>{renderTime(v)}</div>
                  <div style={{ display: "flex", justifyContent: "center" }}>{renderPhoto(v)}</div>
                  <div style={{ fontFamily: A.mono, fontSize: 11, color: isSkipped ? A.danger : A.ink, paddingLeft: 72, paddingRight: 0 }}>{v.order_number || "—"}</div>
                  <div style={{ fontFamily: A.mono, fontSize: 11, textAlign: "center" }}>{v.order_quantity != null ? v.order_quantity : "—"}</div>
                  <div style={{ fontFamily: A.mono, fontSize: 11.5, textAlign: "right", fontWeight: 500 }}>
                    {v.order_amount != null ? `R\u00A0${Number(v.order_amount).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                  </div>
                  <div style={{ fontSize: 11.5, color: A.inkMute, fontStyle: v.notes ? "italic" : "normal", paddingLeft: 80 }}>
                    {v.notes ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "block", cursor: "default" }}>{v.notes}</span>
                        </TooltipTrigger>
                        <TooltipContent className="max-w-xs whitespace-pre-wrap">{v.notes}</TooltipContent>
                      </Tooltip>
                    ) : "—"}
                  </div>
                  <div style={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
                    <button type="button" onClick={() => openEdit(v)} title="Edit" style={{ padding: 5, background: "transparent", border: "none", color: A.inkSoft, cursor: "pointer" }}>
                      <Pencil size={13} />
                    </button>
                    <button type="button" onClick={() => del(v.id)} title="Delete" style={{ padding: 5, background: "transparent", border: "none", color: A.danger, cursor: "pointer" }}>
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              );
              })}
            </div>

            {totalCount > PAGE_SIZE && (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 24, padding: "12px 4px", marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={page === 0}
                  style={{ padding: "6px 14px", borderRadius: 7, border: `1px solid ${A.border}`, background: A.panel, color: page === 0 ? A.inkMute : A.ink, fontSize: 12, fontFamily: A.sans, cursor: page === 0 ? "not-allowed" : "pointer", fontWeight: 500 }}
                >
                  ← Previous
                </button>
                <div style={{ fontSize: 12, color: A.inkMute, fontFamily: A.sans }}>
                  {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, totalCount)} of {totalCount}
                </div>
                <button
                  type="button"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={(page + 1) * PAGE_SIZE >= totalCount}
                  style={{ padding: "6px 14px", borderRadius: 7, border: `1px solid ${A.border}`, background: A.panel, color: (page + 1) * PAGE_SIZE >= totalCount ? A.inkMute : A.ink, fontSize: 12, fontFamily: A.sans, cursor: (page + 1) * PAGE_SIZE >= totalCount ? "not-allowed" : "pointer", fontWeight: 500 }}
                >
                  Next →
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editVisit} onOpenChange={(o) => !o && setEditVisit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Visit</DialogTitle><DialogDescription>Update the visit date, times, and notes.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div><Label>Date</Label><Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} /></div>
            <div><Label>Arrival</Label><Input type="time" value={editArrival} onChange={(e) => setEditArrival(e.target.value)} /></div>
            <div><Label>Leaving</Label><Input type="time" value={editLeaving} onChange={(e) => setEditLeaving(e.target.value)} /></div>
            <div><Label>Notes</Label><Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></div>
            <div><Label>Order No.</Label><Input value={editOrderNumber} onChange={(e) => setEditOrderNumber(e.target.value)} /></div>
            <div><Label>Qty</Label><Input type="number" min="0" step="1" value={editOrderQty} onChange={(e) => setEditOrderQty(e.target.value)} /></div>
            <div><Label>Amount</Label><Input type="number" min="0" step="0.01" value={editOrderAmount} onChange={(e) => setEditOrderAmount(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={saveEdit}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Photo lightbox */}
      <Dialog open={!!photoModal} onOpenChange={(o) => !o && setPhotoModal(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Visit Photo</DialogTitle>
            <DialogDescription>Photo taken during the visit.</DialogDescription>
          </DialogHeader>
          {photoModal && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span><strong className="text-foreground">Rep:</strong> {photoModal.reps?.rep_name}</span>
                <span><strong className="text-foreground">Customer:</strong> {photoModal.customers?.customer_name}</span>
                <span><strong className="text-foreground">Date:</strong> {photoModal.visit_date}</span>
              </div>
              <div className="rounded-lg overflow-hidden border border-border">
                <img
                  src={photoModal.photo_url}
                  alt={`Visit photo — ${photoModal.customers?.customer_name}`}
                  className="w-full h-auto max-h-[70vh] object-contain bg-muted"
                />
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}