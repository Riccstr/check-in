import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import { Users, Plus, Pencil, ArrowUpDown, Filter, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";

type SortKey = "customer_name" | "area" | "rep";

export default function AdminCustomers() {
  const navigate = useNavigate();
  const [customers, setCustomers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [reps, setReps] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [selectedRepId, setSelectedRepId] = useState<string>("none");
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [accountNumberError, setAccountNumberError] = useState<string>("");
  const [checkingAccount, setCheckingAccount] = useState(false);
  
  const [sortKey, setSortKey] = useState<SortKey>("customer_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterReps, setFilterReps] = useState<string[]>([]);
  const [filterAreas, setFilterAreas] = useState<string[]>([]);
  const [filterStatus, setFilterStatus] = useState("all");

  const fetchAll = async () => {
    setLoading(true);
    const [custRes, assignRes, repRes] = await Promise.all([
      supabase.from("customers").select("*").order("customer_name"),
      supabase.from("customer_assignments").select("customer_id, rep_id"),
      supabase.from("reps").select("id, rep_name, surname, is_active"),
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

  const areas = useMemo(() => {
    const set = new Set<string>();
    customers.forEach((c) => { if (c.area && c.area.trim()) set.add(c.area.trim()); });
    return Array.from(set).sort();
  }, [customers]);

  const repNamesForFilter = useMemo(() => {
    const set = new Set<string>();
    for (const a of assignments) {
      const name = repMap[a.rep_id];
      if (name) set.add(name);
    }
    return Array.from(set).sort();
  }, [assignments, repMap]);

  // Real-time account number uniqueness check
  useEffect(() => {
    const trimmed = accountNumber.trim();
    if (!trimmed) { setAccountNumberError(""); return; }
    setCheckingAccount(true);
    const timeout = setTimeout(async () => {
      let query = supabase.from("customers").select("id").eq("account_number", trimmed);
      if (editId) query = query.neq("id", editId);
      const { data } = await query.limit(1);
      if (data && data.length > 0) {
        setAccountNumberError("This account number is already in use");
      } else {
        setAccountNumberError("");
      }
      setCheckingAccount(false);
    }, 300);
    return () => { clearTimeout(timeout); setCheckingAccount(false); };
  }, [accountNumber, editId]);

  const openNew = () => { setEditId(null); setName(""); setArea(""); setAccountNumber(""); setSelectedRepId("none"); setAccountNumberError(""); setDialogOpen(true); };
  const openEdit = (c: any) => {
    setEditId(c.id); setName(c.customer_name); setArea(c.area || ""); setAccountNumber(c.account_number || "");
    setAccountNumberError("");
    const assignedRep = assignments.find((a) => a.customer_id === c.id);
    setSelectedRepId(assignedRep?.rep_id || "none");
    setDialogOpen(true);
  };

  const save = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    if (accountNumberError) { toast.error("Account number is already in use — it must be unique"); return; }
    if (checkingAccount) { toast.error("Still checking account number, please wait"); return; }
    const payload: any = { customer_name: name.trim(), area: area.trim() || null, account_number: accountNumber.trim() || null };
    let customerId = editId;
    if (editId) {
      const { error } = await supabase.from("customers").update(payload).eq("id", editId);
      if (error) { toast.error(error.message); return; }
    } else {
      const { data, error } = await supabase.from("customers").insert(payload).select("id").single();
      if (error) { toast.error(error.message); return; }
      customerId = data.id;
    }

    // Handle rep assignment
    if (customerId) {
      // Remove existing assignment
      await supabase.from("customer_assignments").delete().eq("customer_id", customerId);
      // Add new assignment if a rep is selected
      if (selectedRepId !== "none") {
        await supabase.from("customer_assignments").insert({ customer_id: customerId, rep_id: selectedRepId });
      }
    }

    toast.success(editId ? "Updated" : "Created");
    setDialogOpen(false); fetchAll();
  };

  const toggleActive = async (c: any) => {
    await supabase.from("customers").update({ is_active: !c.is_active }).eq("id", c.id);
    toast.success(c.is_active ? "Deactivated" : "Reactivated"); fetchAll();
  };

  const deleteCustomer = async () => {
    if (!deleteTarget) return;
    const id = deleteTarget.id;

    // Delete related records first, then the customer
    const { error: e1 } = await supabase.from("schedule_template_items").delete().eq("customer_id", id);
    if (e1) { toast.error("Failed to remove template items: " + e1.message); setDeleteTarget(null); return; }

    const { error: e2 } = await supabase.from("schedule_items").delete().eq("customer_id", id);
    if (e2) { toast.error("Failed to remove schedule items: " + e2.message); setDeleteTarget(null); return; }

    const { error: e3 } = await supabase.from("visits").delete().eq("customer_id", id);
    if (e3) { toast.error("Failed to remove visits: " + e3.message); setDeleteTarget(null); return; }

    const { error: e4 } = await supabase.from("customer_assignments").delete().eq("customer_id", id);
    if (e4) { toast.error("Failed to remove assignments: " + e4.message); setDeleteTarget(null); return; }

    const { error } = await supabase.from("customers").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("Customer deleted permanently");

    setDeleteTarget(null);
    fetchAll();
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(true); }
  };

  const activeFilterCount = (filterReps.length > 0 ? 1 : 0) + (filterAreas.length > 0 ? 1 : 0) + (filterStatus !== "all" ? 1 : 0);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = customers.filter((c) =>
      c.customer_name.toLowerCase().includes(q) ||
      (c.area || "").toLowerCase().includes(q) ||
      (customerRepMap[c.id] || "").toLowerCase().includes(q)
    );

    if (filterReps.length > 0) list = list.filter((c) => filterReps.includes(customerRepMap[c.id] || ""));
    if (filterAreas.length > 0) list = list.filter((c) => filterAreas.includes(c.area || ""));
    if (filterStatus !== "all") list = list.filter((c) => filterStatus === "active" ? c.is_active : !c.is_active);

    list.sort((a, b) => {
      let va: string, vb: string;
      if (sortKey === "customer_name") { va = a.customer_name; vb = b.customer_name; }
      else if (sortKey === "area") { va = a.area || ""; vb = b.area || ""; }
      else { va = customerRepMap[a.id] || ""; vb = customerRepMap[b.id] || ""; }
      const cmp = va.localeCompare(vb, undefined, { sensitivity: "base" });
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [customers, search, sortKey, sortAsc, customerRepMap, filterReps, filterAreas, filterStatus]);

  const SortButton = ({ label, sortId }: { label: string; sortId: SortKey }) => (
    <Button variant="ghost" size="sm" className="-ml-3 h-8 font-medium" onClick={() => handleSort(sortId)}>
      {label}
      <ArrowUpDown className="ml-1 h-3 w-3 text-muted-foreground" />
    </Button>
  );

  const clearFilters = () => { setFilterReps([]); setFilterAreas([]); setFilterStatus("all"); };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5 text-accent" /> Customers</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add</Button>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <Input placeholder="Search customers..." value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1">
                <Filter className="h-4 w-4" /> Filter
                {activeFilterCount > 0 && <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-xs">{activeFilterCount}</Badge>}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 space-y-3" align="start">
              {/* Active filter badges */}
              {(filterReps.length > 0 || filterAreas.length > 0 || filterStatus !== "all") && (
                <div className="flex flex-wrap gap-1">
                  {filterReps.map((r) => (
                    <Badge key={r} variant="secondary" className="text-xs gap-1">
                      {r}
                      <button onClick={() => setFilterReps(filterReps.filter((x) => x !== r))} className="ml-0.5 hover:text-destructive">×</button>
                    </Badge>
                  ))}
                  {filterAreas.map((a) => (
                    <Badge key={a} variant="secondary" className="text-xs gap-1">
                      {a}
                      <button onClick={() => setFilterAreas(filterAreas.filter((x) => x !== a))} className="ml-0.5 hover:text-destructive">×</button>
                    </Badge>
                  ))}
                  {filterStatus !== "all" && (
                    <Badge variant="secondary" className="text-xs gap-1">
                      {filterStatus === "active" ? "Active" : "Inactive"}
                      <button onClick={() => setFilterStatus("all")} className="ml-0.5 hover:text-destructive">×</button>
                    </Badge>
                  )}
                </div>
              )}

              {/* Rep multi-select */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Rep</Label>
                <div className="max-h-32 overflow-y-auto space-y-1 border rounded-md p-2">
                  {repNamesForFilter.map((name) => (
                    <label key={name} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                      <Checkbox
                        checked={filterReps.includes(name)}
                        onCheckedChange={(checked) => {
                          if (checked) setFilterReps([...filterReps, name]);
                          else setFilterReps(filterReps.filter((r) => r !== name));
                        }}
                      />
                      {name}
                    </label>
                  ))}
                  {repNamesForFilter.length === 0 && <p className="text-xs text-muted-foreground">No assigned reps</p>}
                </div>
              </div>

              {/* Area multi-select */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Area</Label>
                <div className="max-h-32 overflow-y-auto space-y-1 border rounded-md p-2">
                  {areas.map((area) => (
                    <label key={area} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                      <Checkbox
                        checked={filterAreas.includes(area)}
                        onCheckedChange={(checked) => {
                          if (checked) setFilterAreas([...filterAreas, area]);
                          else setFilterAreas(filterAreas.filter((a) => a !== area));
                        }}
                      />
                      {area}
                    </label>
                  ))}
                  {areas.length === 0 && <p className="text-xs text-muted-foreground">No areas</p>}
                </div>
              </div>

              {/* Status single-select */}
              <div className="space-y-1">
                <Label className="text-xs font-medium">Status</Label>
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All</SelectItem>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {activeFilterCount > 0 && (
                <Button variant="ghost" size="sm" className="w-full" onClick={clearFilters}>Clear filters</Button>
              )}
            </PopoverContent>
          </Popover>
        </div>
        {loading ? <p className="text-muted-foreground py-4">Loading...</p> : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead><SortButton label="Name" sortId="customer_name" /></TableHead>
                <TableHead>Acc #</TableHead>
                <TableHead><SortButton label="Area" sortId="area" /></TableHead>
                <TableHead><SortButton label="Rep" sortId="rep" /></TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <button
                      onClick={() => navigate(`/admin/customer/${c.id}`)}
                      className="text-left hover:underline hover:text-primary transition-colors"
                    >
                      {c.customer_name}
                    </button>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{c.account_number || "—"}</TableCell>
                  <TableCell>{c.area || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{customerRepMap[c.id] || "Unassigned"}</TableCell>
                  
                  <TableCell><Badge variant={c.is_active ? "default" : "secondary"}>{c.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(c)}>{c.is_active ? "Deactivate" : "Reactivate"}</Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(c)} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Edit/Add Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Customer</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div>
              <Label>Account Number</Label>
              <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="e.g. ACC-001" className={accountNumberError ? "border-destructive" : ""} />
              {accountNumberError && <p className="text-destructive text-xs mt-1">{accountNumberError}</p>}
            </div>
            <div><Label>Area</Label><Input value={area} onChange={(e) => setArea(e.target.value)} placeholder="e.g. Johannesburg North" /></div>
            <div>
              <Label>Assign to Rep</Label>
              <Select value={selectedRepId} onValueChange={setSelectedRepId}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Select a rep" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No rep</SelectItem>
                  {reps.filter((r) => r.is_active).map((r) => (
                    <SelectItem key={r.id} value={r.id}>{r.rep_name}{r.surname ? ` ${r.surname}` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete customer permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.customer_name}</strong> and all associated visits, schedule items, template items, and assignments. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteCustomer} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
