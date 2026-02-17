import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Users, Plus, Pencil, ArrowUpDown } from "lucide-react";

type SortKey = "customer_name" | "area" | "rep";

export default function AdminCustomers() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("customer_name");
  const [sortAsc, setSortAsc] = useState(true);

  const fetchAll = async () => {
    setLoading(true);
    const [custRes, assignRes, repRes] = await Promise.all([
      supabase.from("customers").select("*").order("customer_name"),
      supabase.from("customer_assignments").select("customer_id, rep_id"),
      supabase.from("reps").select("id, rep_name, surname"),
    ]);
    setCustomers(custRes.data || []);
    setAssignments(assignRes.data || []);
    setReps(repRes.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const repMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of reps) {
      m[r.id] = `${r.rep_name}${r.surname ? " " + r.surname : ""}`;
    }
    return m;
  }, [reps]);

  const customerRepMap = useMemo(() => {
    const m: Record<string, string> = {};
    for (const a of assignments) {
      m[a.customer_id] = repMap[a.rep_id] || "—";
    }
    return m;
  }, [assignments, repMap]);

  const openNew = () => { setEditId(null); setName(""); setArea(""); setDialogOpen(true); };
  const openEdit = (c: any) => { setEditId(c.id); setName(c.customer_name); setArea(c.area || ""); setDialogOpen(true); };

  const save = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    const payload = { customer_name: name.trim(), area: area.trim() || null };
    if (editId) {
      const { error } = await supabase.from("customers").update(payload).eq("id", editId);
      if (error) toast.error(error.message); else toast.success("Updated");
    } else {
      const { error } = await supabase.from("customers").insert(payload);
      if (error) toast.error(error.message); else toast.success("Created");
    }
    setDialogOpen(false); fetchAll();
  };

  const toggleActive = async (c: any) => {
    await supabase.from("customers").update({ is_active: !c.is_active }).eq("id", c.id);
    toast.success(c.is_active ? "Deactivated" : "Reactivated"); fetchAll();
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = customers.filter((c) =>
      c.customer_name.toLowerCase().includes(q) ||
      (c.area || "").toLowerCase().includes(q) ||
      (customerRepMap[c.id] || "").toLowerCase().includes(q)
    );

    list.sort((a, b) => {
      let va: string, vb: string;
      if (sortKey === "customer_name") { va = a.customer_name; vb = b.customer_name; }
      else if (sortKey === "area") { va = a.area || ""; vb = b.area || ""; }
      else { va = customerRepMap[a.id] || ""; vb = customerRepMap[b.id] || ""; }
      const cmp = va.localeCompare(vb, undefined, { sensitivity: "base" });
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [customers, search, sortKey, sortAsc, customerRepMap]);

  const SortButton = ({ label, sortId }: { label: string; sortId: SortKey }) => (
    <Button variant="ghost" size="sm" className="-ml-3 h-8 font-medium" onClick={() => handleSort(sortId)}>
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground" />
    </Button>
  );

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-accent" /> Customers</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add</Button>
      </CardHeader>
      <CardContent>
        <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="mb-4 max-w-xs" />
        {loading ? <p className="text-muted-foreground py-4">Loading...</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortButton label="Name" sortId="customer_name" /></TableHead>
                <TableHead><SortButton label="Area" sortId="area" /></TableHead>
                <TableHead><SortButton label="Rep" sortId="rep" /></TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.customer_name}</TableCell>
                  <TableCell>{c.area || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{customerRepMap[c.id] || "Unassigned"}</TableCell>
                  <TableCell><Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(c)}>{c.is_active ? "Deactivate" : "Reactivate"}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Area</Label><Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Johannesburg North" /></div>
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
