import { useState, useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Eye, Pencil, Trash2 } from "lucide-react";

interface Visit {
  id: string;
  visit_date: string;
  arrival_time: string;
  leaving_time: string;
  duration_minutes: number;
  notes: string | null;
  customer_id: string;
  customers: { customer_name: string } | null;
}

export default function MyVisits() {
  const { repId } = useAuth();
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [customerFilter, setCustomerFilter] = useState("all");
  const [customers, setCustomers] = useState<{ id: string; customer_name: string }[]>([]);
  const [editVisit, setEditVisit] = useState<Visit | null>(null);
  const [editArrival, setEditArrival] = useState("");
  const [editLeaving, setEditLeaving] = useState("");
  const [editNotes, setEditNotes] = useState("");
  const [editDate, setEditDate] = useState("");

  const fetchVisits = async () => {
    if (!repId) return;
    setLoading(true);
    let q = supabase
      .from("visits")
      .select("*, customers(customer_name)")
      .eq("rep_id", repId)
      .order("visit_date", { ascending: false });
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    if (customerFilter && customerFilter !== "all") q = q.eq("customer_id", customerFilter);
    const { data } = await q;
    setVisits((data as any) || []);
    setLoading(false);
  };

  useEffect(() => {
    if (!repId) return;
    supabase.from("customer_assignments").select("customer_id, customers(id, customer_name)").eq("rep_id", repId)
      .then(({ data }) => {
        if (data) setCustomers(data.map((d: any) => ({ id: d.customers.id, customer_name: d.customers.customer_name })));
      });
  }, [repId]);

  useEffect(() => { fetchVisits(); }, [repId, dateFrom, dateTo, customerFilter]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this visit?")) return;
    const { error } = await supabase.from("visits").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Visit deleted"); fetchVisits(); }
  };

  const openEdit = (v: Visit) => {
    setEditVisit(v);
    setEditArrival(v.arrival_time);
    setEditLeaving(v.leaving_time);
    setEditNotes(v.notes || "");
    setEditDate(v.visit_date);
  };

  const calcDur = (a: string, l: string) => {
    const [ah, am] = a.split(":").map(Number);
    const [lh, lm] = l.split(":").map(Number);
    return (lh * 60 + lm) - (ah * 60 + am);
  };

  const saveEdit = async () => {
    if (!editVisit) return;
    const dur = calcDur(editArrival, editLeaving);
    if (dur <= 0) { toast.error("Leaving time must be after arrival time"); return; }
    const { error } = await supabase.from("visits").update({
      arrival_time: editArrival, leaving_time: editLeaving, duration_minutes: dur, notes: editNotes || null, visit_date: editDate,
    }).eq("id", editVisit.id);
    if (error) toast.error(error.message);
    else { toast.success("Updated"); setEditVisit(null); fetchVisits(); }
  };

  return (
    <div>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-accent" /> My Visits</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className="w-40" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Customer</Label>
              <Select value={customerFilter} onValueChange={setCustomerFilter}>
                <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Customers</SelectItem>
                  {customers.map((c) => <SelectItem key={c.id} value={c.id}>{c.customer_name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          {loading ? (
            <p className="text-muted-foreground text-center py-8">Loading...</p>
          ) : visits.length === 0 ? (
            <p className="text-muted-foreground text-center py-8">No visits found.</p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Customer</TableHead>
                    <TableHead>Arrival</TableHead>
                    <TableHead>Leaving</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visits.map((v) => (
                    <TableRow key={v.id}>
                      <TableCell>{v.visit_date}</TableCell>
                      <TableCell>{v.customers?.customer_name}</TableCell>
                      <TableCell>{v.arrival_time?.slice(0,5)}</TableCell>
                      <TableCell>{v.leaving_time?.slice(0,5)}</TableCell>
                      <TableCell>{v.duration_minutes} min</TableCell>
                      <TableCell className="max-w-[200px] truncate">{v.notes || "—"}</TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(v)}><Pencil className="h-4 w-4" /></Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelete(v.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}
