import { useState, useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Eye, Pencil, Trash2, Camera } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export default function AdminVisits() {
  const [visits, setVisits] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [repFilter, setRepFilter] = useState("all");
  const [custFilter, setCustFilter] = useState("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [editVisit, setEditVisit] = useState<any>(null);
  const [editArrival, setEditArrival] = useState("");
  const [editLeaving, setEditLeaving] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDate, setEditDate] = useState("");
  const [editOrderNumber, setEditOrderNumber] = useState("");
  const [editOrderQty, setEditOrderQty] = useState("");
  const [editOrderAmount, setEditOrderAmount] = useState("");
  const [photoModal, setPhotoModal] = useState<any>(null);

  const fetchVisits = async () => {
    setLoading(true);
    let q = supabase.from("visits").select("*, reps(rep_name), customers(customer_name, account_number)").order("visit_date", { ascending: false });
    if (repFilter !== "all") q = q.eq("rep_id", repFilter);
    if (custFilter !== "all") q = q.eq("customer_id", custFilter);
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    const { data } = await q;
    setVisits(data || []);
    setLoading(false);
  };

  useEffect(() => {
    Promise.all([
      supabase.from("reps").select("id, rep_name").order("rep_name"),
      supabase.from("customers").select("id, customer_name, area").order("customer_name"),
    ]).then(([r, c]) => { setReps(r.data || []); setCustomers(c.data || []); });
  }, []);

  useEffect(() => { fetchVisits(); }, [repFilter, custFilter, dateFrom, dateTo]);

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
    const { error } = await supabase.from("visits").delete().eq("id", id);
    if (error) { toast.error("Failed to delete: " + error.message); return; }
    toast.success("Deleted"); fetchVisits();
  };

  const openEdit = (v: any) => { setEditVisit(v); setEditArrival(v.arrival_time); setEditLeaving(v.leaving_time); setEditNotes(v.notes || ""); setEditDate(v.visit_date); setEditOrderNumber(v.order_number || ""); setEditOrderQty(v.order_quantity != null ? String(v.order_quantity) : ""); setEditOrderAmount(v.order_amount != null ? String(v.order_amount) : ""); };

  const saveEdit = async () => {
    const [ah, am] = editArrival.split(":").map(Number);
    const [lh, lm] = editLeaving.split(":").map(Number);
    const dur = (lh * 60 + lm) - (ah * 60 + am);
    if (dur <= 0) { toast.error("Invalid times"); return; }
    await supabase.from("visits").update({ arrival_time: editArrival, leaving_time: editLeaving, duration_minutes: dur, notes: editNotes || null, visit_date: editDate, order_number: editOrderNumber || null, order_quantity: editOrderQty !== "" ? Number(editOrderQty) : null, order_amount: editOrderAmount !== "" ? Number(editOrderAmount) : null }).eq("id", editVisit.id);
    toast.success("Updated"); setEditVisit(null); fetchVisits();
  };

  const renderPhoto = (v: any) => {
    if (v.photo_url) {
      return (
        <button
          onClick={() => setPhotoModal(v)}
          className="block rounded overflow-hidden border border-border hover:ring-2 hover:ring-primary/50 transition-all"
          style={{ width: 40, height: 40 }}
        >
          <img
            src={v.photo_url}
            alt="Visit photo"
            className="w-full h-full object-cover"
            loading="lazy"
          />
        </button>
      );
    }
    return <span className="text-muted-foreground">—</span>;
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-accent" /> All Visits</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-end gap-3 mb-4">
          <div className="flex flex-col gap-1"><Label className="text-xs">Rep</Label>
            <SearchableSelect
              value={repFilter}
              onValueChange={setRepFilter}
              options={reps.map((r) => ({ value: r.id, label: r.rep_name }))}
              placeholder="All Reps"
              searchPlaceholder="Search reps..."
              includeAll
              allLabel="All Reps"
              className="w-40"
            /></div>
          <div className="flex flex-col gap-1"><Label className="text-xs">Customer</Label>
            <SearchableSelect
              value={custFilter}
              onValueChange={setCustFilter}
              options={customers.map((c) => ({ value: c.id, label: c.customer_name + (c.area ? ` (${c.area})` : "") }))}
              placeholder="All Customers"
              searchPlaceholder="Search customers..."
              includeAll
              allLabel="All Customers"
              className="w-44"
            /></div>
          <div className="flex flex-col gap-1"><Label className="text-xs">From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" /></div>
          <div className="flex flex-col gap-1"><Label className="text-xs">To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" /></div>
        </div>
        {loading ? <p className="text-muted-foreground py-8 text-center">Loading...</p> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Rep</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Acc #</TableHead>
                  <TableHead>Arrival</TableHead>
                  <TableHead>Leaving</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead><Camera className="h-3.5 w-3.5 inline mr-1" />Photo</TableHead>
                  <TableHead>Order No.</TableHead>
                  <TableHead>Qty</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visits.map((v: any) => (
                   <TableRow key={v.id} className={v.status === "skipped" ? "bg-destructive/10" : ""}>
                    <TableCell>{v.visit_date}</TableCell>
                    <TableCell>{v.reps?.rep_name}</TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {v.customers?.customer_name}
                        {v.status === "skipped" && <Badge variant="destructive" className="text-xs">Skipped</Badge>}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{v.customers?.account_number || "—"}</TableCell>
                    <TableCell>{v.status === "skipped" ? "—" : v.arrival_time?.slice(0,5)}</TableCell>
                    <TableCell>{v.status === "skipped" ? "—" : v.leaving_time?.slice(0,5)}</TableCell>
                    <TableCell>{v.status === "skipped" ? "—" : `${v.duration_minutes} min`}</TableCell>
                    <TableCell>{renderPhoto(v)}</TableCell>
                    <TableCell>{v.order_number || "—"}</TableCell>
                    <TableCell>{v.order_quantity != null ? v.order_quantity : "—"}</TableCell>
                    <TableCell>{v.order_amount != null ? v.order_amount : "—"}</TableCell>
                    <TableCell className="max-w-[150px]">
                      {v.notes ? (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <span className="truncate block cursor-default">{v.notes}</span>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-xs whitespace-pre-wrap">{v.notes}</TooltipContent>
                        </Tooltip>
                      ) : "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(v)}><Pencil className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => del(v.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

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
    </Card>
  );
}
