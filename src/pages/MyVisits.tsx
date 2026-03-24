import { useState, useEffect, useCallback } from "react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Eye, Pencil, Trash2, RefreshCw, Camera } from "lucide-react";
import { getAllOfflineVisits, type OfflineVisit } from "@/lib/offlineDb";
import { syncPendingVisits } from "@/lib/syncEngine";

interface Visit {
  id: string;
  visit_date: string;
  arrival_time: string;
  leaving_time: string;
  duration_minutes: number;
  notes: string | null;
  status: string;
  customer_id: string;
  customers: { customer_name: string } | null;
  photo_url?: string | null;
  _offline?: boolean;
  _sync_status?: "pending" | "synced" | "error";
  _error_message?: string | null;
  _client_generated_id?: string;
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
  const [photoModal, setPhotoModal] = useState<Visit | null>(null);

  const fetchVisits = useCallback(async () => {
    if (!repId) return;
    setLoading(true);

    let q = supabase
      .from("visits")
      .select("*, customers(customer_name, account_number)")
      .eq("rep_id", repId)
      .order("visit_date", { ascending: false });
    if (dateFrom) q = q.gte("visit_date", dateFrom);
    if (dateTo) q = q.lte("visit_date", dateTo);
    if (customerFilter && customerFilter !== "all") q = q.eq("customer_id", customerFilter);

    let serverVisits: Visit[] = [];
    try {
      const { data } = await q;
      serverVisits = (data as any) || [];
    } catch {
      // Offline - no server data
    }

    // Fetch offline visits
    const offlineVisits = await getAllOfflineVisits();
    const offlineAsVisits: Visit[] = offlineVisits
      .filter((ov) => ov.sync_status !== "synced")
      .filter((ov) => ov.payload.rep_id === repId)
      .filter((ov) => {
        if (customerFilter && customerFilter !== "all" && ov.payload.customer_id !== customerFilter) return false;
        if (dateFrom && ov.payload.visit_date < dateFrom) return false;
        if (dateTo && ov.payload.visit_date > dateTo) return false;
        return true;
      })
      .map((ov) => ({
        id: ov.client_generated_id,
        visit_date: ov.payload.visit_date,
        arrival_time: ov.payload.arrival_time,
        leaving_time: ov.payload.leaving_time,
        duration_minutes: ov.payload.duration_minutes,
        notes: ov.payload.notes,
        status: (ov.payload as any).status || "visited",
        customer_id: ov.payload.customer_id,
        customers: { customer_name: ov.customer_name || "Unknown" },
        photo_url: null,
        _offline: true,
        _sync_status: ov.sync_status,
        _error_message: ov.error_message,
        _client_generated_id: ov.client_generated_id,
      }));

    // Merge: offline first, then server (deduplicate by client_generated_id)
    const serverClientIds = new Set(
      serverVisits
        .filter((v: any) => v.client_generated_id)
        .map((v: any) => v.client_generated_id)
    );
    const uniqueOffline = offlineAsVisits.filter(
      (ov) => !serverClientIds.has(ov._client_generated_id)
    );

    const merged = [...uniqueOffline, ...serverVisits];
    merged.sort((a, b) => b.visit_date.localeCompare(a.visit_date));

    setVisits(merged);
    setLoading(false);
  }, [repId, dateFrom, dateTo, customerFilter]);

  useEffect(() => {
    if (!repId) return;
    supabase.from("customer_assignments").select("customer_id, customers(id, customer_name)").eq("rep_id", repId)
      .then(({ data }) => {
        if (data) setCustomers(data.map((d: any) => ({ id: d.customers.id, customer_name: d.customers.customer_name })));
      });
  }, [repId]);

  useEffect(() => { fetchVisits(); }, [fetchVisits]);

  const handleDelete = async (id: string) => {
    if (!confirm("Delete this visit?")) return;
    const { error } = await supabase.from("visits").delete().eq("id", id);
    if (error) toast.error(error.message);
    else { toast.success("Visit deleted"); fetchVisits(); }
  };

  const openEdit = (v: Visit) => {
    if (v._offline) return;
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

  const handleRetrySync = async () => {
    const result = await syncPendingVisits();
    if (result.synced > 0) toast.success(`${result.synced} visit(s) synced`);
    if (result.errors > 0) toast.error(`${result.errors} visit(s) failed`);
    fetchVisits();
  };

  const hasPendingOffline = visits.some((v) => v._offline);

  const renderPhoto = (v: Visit) => {
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
    <div>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2"><Eye className="h-5 w-5 text-accent" /> My Visits</CardTitle>
            {hasPendingOffline && navigator.onLine && (
              <Button variant="outline" size="sm" onClick={handleRetrySync}>
                <RefreshCw className="h-4 w-4 mr-1" /> Sync Now
              </Button>
            )}
          </div>
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
              <SearchableSelect
                value={customerFilter}
                onValueChange={setCustomerFilter}
                options={customers.map((c) => ({ value: c.id, label: c.customer_name }))}
                placeholder="All Customers"
                searchPlaceholder="Search customers..."
                includeAll
                allLabel="All Customers"
                className="w-44"
              />
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
                    <TableHead>Acc #</TableHead>
                    <TableHead>Arrival</TableHead>
                    <TableHead>Leaving</TableHead>
                    <TableHead>Duration</TableHead>
                    <TableHead><Camera className="h-3.5 w-3.5 inline mr-1" />Photo</TableHead>
                    <TableHead>Notes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visits.map((v) => (
                    <TableRow key={v.id} className={`${v._offline ? "opacity-80" : ""} ${v.status === "skipped" ? "bg-destructive/10" : ""}`}>
                      <TableCell>{v.visit_date}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {v.customers?.customer_name}
                          {v.status === "skipped" && <Badge variant="destructive" className="text-xs">Skipped</Badge>}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{(v as any).customers?.account_number || "—"}</TableCell>
                      <TableCell>{v.status === "skipped" ? "—" : v.arrival_time?.slice(0,5)}</TableCell>
                      <TableCell>{v.status === "skipped" ? "—" : v.leaving_time?.slice(0,5)}</TableCell>
                      <TableCell>{v.status === "skipped" ? "—" : `${v.duration_minutes} min`}</TableCell>
                      <TableCell>{renderPhoto(v)}</TableCell>
                      <TableCell className="max-w-[200px] truncate">{v.notes || "—"}</TableCell>
                      <TableCell>
                        {v._offline ? (
                          <Badge variant={v._sync_status === "error" ? "destructive" : "secondary"} className="text-xs">
                            {v._sync_status === "pending" ? "Pending" : v._sync_status === "error" ? "Error" : "Synced"}
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="text-xs">Synced</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {!v._offline && (
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" onClick={() => openEdit(v)}><Pencil className="h-4 w-4" /></Button>
                            <Button variant="ghost" size="icon" onClick={() => handleDelete(v.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </div>
                        )}
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

      {/* Photo lightbox */}
      <Dialog open={!!photoModal} onOpenChange={(o) => !o && setPhotoModal(null)}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>Visit Photo</DialogTitle>
          </DialogHeader>
          {photoModal && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <span><strong className="text-foreground">Customer:</strong> {photoModal.customers?.customer_name}</span>
                <span><strong className="text-foreground">Date:</strong> {photoModal.visit_date}</span>
              </div>
              <div className="rounded-lg overflow-hidden border border-border">
                <img
                  src={photoModal.photo_url!}
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
