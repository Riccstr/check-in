import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Eye, Pencil, Trash2 } from "lucide-react";

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

  const fetchVisits = async () => {
    setLoading(true);
    let q = supabase.from("visits").select("*, reps(rep_name), customers(customer_name)").order("visit_date", { ascending: false });
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
      supabase.from("customers").select("id, customer_name").order("customer_name"),
    ]).then(([r, c]) => { setReps(r.data || []); setCustomers(c.data || []); });
  }, []);

  useEffect(() => { fetchVisits(); }, [repFilter, custFilter, dateFrom, dateTo]);

  const del = async (id: string) => {
    if (!confirm("Delete this visit?")) return;
    await supabase.from("visits").delete().eq("id", id);
    toast.success("Deleted"); fetchVisits();
  };

  const openEdit = (v: any) => { setEditVisit(v); setEditArrival(v.arrival_time); setEditLeaving(v.leaving_time); setEditNotes(v.notes || ""); setEditDate(v.visit_date); };

  const saveEdit = async () => {
    const [ah, am] = editArrival.split(":").map(Number);
    const [lh, lm] = editLeaving.split(":").map(Number);
    const dur = (lh * 60 + lm) - (ah * 60 + am);
    if (dur <= 0) { toast.error("Invalid times"); return; }
    await supabase.from("visits").update({ arrival_time: editArrival, leaving_time: editLeaving, duration_minutes: dur, notes: editNotes || null, visit_date: editDate }).eq("id", editVisit.id);
    toast.success("Updated"); setEditVisit(null); fetchVisits();
  };

  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-accent" /> All Visits</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-3 mb-4">
          <div className="space-y-1"><Label className="text-xs">Rep</Label>
            <Select value={repFilter} onValueChange={setRepFilter}><SelectTrigger className="w-40"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Reps</SelectItem>{reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.rep_name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">Customer</Label>
            <Select value={custFilter} onValueChange={setCustFilter}><SelectTrigger className="w-44"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">All Customers</SelectItem>{customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1"><Label className="text-xs">From</Label><Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" /></div>
          <div className="space-y-1"><Label className="text-xs">To</Label><Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" /></div>
        </div>
        {loading ? <p className="text-muted-foreground py-8 text-center">Loading...</p> : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader><TableRow><TableHead>Date</TableHead><TableHead>Rep</TableHead><TableHead>Customer</TableHead><TableHead>Arrival</TableHead><TableHead>Leaving</TableHead><TableHead>Duration</TableHead><TableHead>Notes</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {visits.map((v: any) => (
                  <TableRow key={v.id}>
                    <TableCell>{v.visit_date}</TableCell>
                    <TableCell>{v.reps?.rep_name}</TableCell>
                    <TableCell>{v.customers?.customer_name}</TableCell>
                    <TableCell>{v.arrival_time?.slice(0,5)}</TableCell>
                    <TableCell>{v.leaving_time?.slice(0,5)}</TableCell>
                    <TableCell>{v.duration_minutes} min</TableCell>
                    <TableCell className="max-w-[150px] truncate">{v.notes || "—"}</TableCell>
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
      <Dialog open={!!editVisit} onOpenChange={(o) => !o && setEditVisit(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit Visit</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Date</Label><Input type="date" value={editDate} onChange={(e) => setEditDate(e.target.value)} /></div>
            <div><Label>Arrival</Label><Input type="time" value={editArrival} onChange={(e) => setEditArrival(e.target.value)} /></div>
            <div><Label>Leaving</Label><Input type="time" value={editLeaving} onChange={(e) => setEditLeaving(e.target.value)} /></div>
            <div><Label>Notes</Label><Textarea value={editNotes} onChange={(e) => setEditNotes(e.target.value)} /></div>
          </div>
          <DialogFooter><Button onClick={saveEdit}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
