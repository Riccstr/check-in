import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandList, CommandItem, CommandEmpty } from "@/components/ui/command";
import { toast } from "sonner";
import { Plus, Pencil, Filter, Trash2, Download } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { A, PageHeader, StatCard, Tag, FilterChip, PrimaryButton, GhostButton } from "@/lib/adminUi";

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
  const [areaOptions, setAreaOptions] = useState<string[]>([]);
  const [areaDropdownOpen, setAreaDropdownOpen] = useState(false);
  const areaInputRef = useRef<HTMLInputElement>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [selectedRepId, setSelectedRepId] = useState<string>("none");
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [accountNumberError, setAccountNumberError] = useState<string>("");
  const [checkingAccount, setCheckingAccount] = useState(false);
  
  const [sortKey, setSortKey] = useState<SortKey>("customer_name");
  const [sortAsc, setSortAsc] = useState(true);
  const [filterReps, setFilterReps] = useState<string[]>([]);
  const [filterAreas, setFilterAreas] = useState<string[]>([]);

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

  const filteredAreas = useMemo(() => {
    const q = area.trim().toLowerCase();
    if (!q) return areaOptions;
    return areaOptions.filter((a) => a.toLowerCase().includes(q));
  }, [areaOptions, area]);

  const fetchAreaOptions = async () => {
    try {
      const { data } = await supabase.from("customers").select("area").not("area", "is", null).neq("area", "");
      if (data) {
        const unique = [...new Set(data.map((r: any) => r.area).filter(Boolean))].sort() as string[];
        setAreaOptions(unique);
      }
    } catch { /* ignore */ }
  };

  const openNew = () => {
    setEditId(null); setName(""); setArea(""); setAccountNumber(""); setSelectedRepId("none"); setAccountNumberError("");
    setAreaDropdownOpen(false);
    fetchAreaOptions();
    setDialogOpen(true);
  };
  const openEdit = (c: any) => {
    setEditId(c.id); setName(c.customer_name); setArea(c.area || ""); setAccountNumber(c.account_number || "");
    setAccountNumberError("");
    const assignedRep = assignments.find((a) => a.customer_id === c.id);
    setSelectedRepId(assignedRep?.rep_id || "none");
    setAreaDropdownOpen(false);
    fetchAreaOptions();
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

  const activeFilterCount = (filterReps.length > 0 ? 1 : 0) + (filterAreas.length > 0 ? 1 : 0);

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let list = customers.filter((c) =>
      c.customer_name.toLowerCase().includes(q) ||
      (c.area || "").toLowerCase().includes(q) ||
      (customerRepMap[c.id] || "").toLowerCase().includes(q)
    );

    if (filterReps.length > 0) list = list.filter((c) => filterReps.includes(customerRepMap[c.id] || ""));
    if (filterAreas.length > 0) list = list.filter((c) => filterAreas.includes(c.area || ""));

    list.sort((a, b) => {
      let va: string, vb: string;
      if (sortKey === "customer_name") { va = a.customer_name; vb = b.customer_name; }
      else if (sortKey === "area") { va = a.area || ""; vb = b.area || ""; }
      else { va = customerRepMap[a.id] || ""; vb = customerRepMap[b.id] || ""; }
      const cmp = va.localeCompare(vb, undefined, { sensitivity: "base" });
      return sortAsc ? cmp : -cmp;
    });

    return list;
  }, [customers, search, sortKey, sortAsc, customerRepMap, filterReps, filterAreas]);

  const clearFilters = () => { setFilterReps([]); setFilterAreas([]); };

  // ── totals for the stat strip ─────────────────────────────────────────────
  const activeAssignments = new Set(assignments.map((a) => a.customer_id));
  const unassignedCount = customers.filter((c) => !activeAssignments.has(c.id)).length;
  const totalAreas = areas.length;

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: A.bg, minHeight: 0, fontFamily: A.sans, color: A.ink }}>
      <PageHeader
        title="Customers"
        subtitle={`${customers.length} customers · ${totalAreas} ${totalAreas === 1 ? "area" : "areas"}${unassignedCount > 0 ? ` · ${unassignedCount} unassigned` : ""}`}
        right={
          <>
            <GhostButton icon={<Download size={13} />}>Import CSV</GhostButton>
            <PrimaryButton icon={<Plus size={13} />} onClick={openNew}>Add customer</PrimaryButton>
          </>
        }
      />

      {/* Filter strip — preserves all the existing filter logic, just restyled */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "12px 24px", background: A.panel, borderBottom: `1px solid ${A.border}`, flexShrink: 0 }}>
        <div style={{ position: "relative", width: 300 }}>
          <Input
            placeholder="Search customer, area, or rep…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ paddingLeft: 34, height: 32, fontSize: 12.5, background: A.panel, borderColor: A.border }}
          />
          <Filter size={14} style={{ position: "absolute", left: 11, top: "50%", transform: "translateY(-50%)", color: A.inkMute, pointerEvents: "none" }} />
        </div>

        <div style={{ width: 1, height: 22, background: A.borderSoft, margin: "0 4px" }} />

        {/* Rep filter — uses the existing Popover for behaviour, restyled trigger */}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 11px", border: `1px solid ${filterReps.length > 0 ? A.green : A.border}`, borderRadius: 6, background: filterReps.length > 0 ? A.greenSoft : A.panel, color: filterReps.length > 0 ? A.green : A.inkSoft, fontFamily: A.sans, fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}>
              <span style={{ color: filterReps.length > 0 ? A.green : A.inkMute, fontWeight: 600 }}>Rep:</span>
              <span>{filterReps.length === 0 ? "Any" : filterReps.length === 1 ? filterReps[0] : `${filterReps.length} selected`}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2" align="start">
            <Label className="text-xs font-medium">Rep</Label>
            <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
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
            {filterReps.length > 0 && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setFilterReps([])}>Clear</Button>
            )}
          </PopoverContent>
        </Popover>

        {/* Area filter — same pattern */}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "5px 10px 5px 11px", border: `1px solid ${filterAreas.length > 0 ? A.green : A.border}`, borderRadius: 6, background: filterAreas.length > 0 ? A.greenSoft : A.panel, color: filterAreas.length > 0 ? A.green : A.inkSoft, fontFamily: A.sans, fontSize: 11.5, fontWeight: 500, cursor: "pointer" }}>
              <span style={{ color: filterAreas.length > 0 ? A.green : A.inkMute, fontWeight: 600 }}>Area:</span>
              <span>{filterAreas.length === 0 ? "All" : filterAreas.length === 1 ? filterAreas[0] : `${filterAreas.length} selected`}</span>
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 space-y-2" align="start">
            <Label className="text-xs font-medium">Area</Label>
            <div className="max-h-48 overflow-y-auto space-y-1 border rounded-md p-2">
              {areas.map((a) => (
                <label key={a} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-muted rounded px-1 py-0.5">
                  <Checkbox
                    checked={filterAreas.includes(a)}
                    onCheckedChange={(checked) => {
                      if (checked) setFilterAreas([...filterAreas, a]);
                      else setFilterAreas(filterAreas.filter((x) => x !== a));
                    }}
                  />
                  {a}
                </label>
              ))}
              {areas.length === 0 && <p className="text-xs text-muted-foreground">No areas</p>}
            </div>
            {filterAreas.length > 0 && (
              <Button variant="ghost" size="sm" className="w-full" onClick={() => setFilterAreas([])}>Clear</Button>
            )}
          </PopoverContent>
        </Popover>

        <FilterChip
          label="Sort:"
          value={`${sortKey === "customer_name" ? "Name" : sortKey === "area" ? "Area" : "Rep"} ${sortAsc ? "↑" : "↓"}`}
          active
          onClick={() => {
            // cycle: name → area → rep → name, toggling asc on first hit per key
            const order: SortKey[] = ["customer_name", "area", "rep"];
            const next = order[(order.indexOf(sortKey) + 1) % order.length];
            setSortKey(next);
            setSortAsc(true);
          }}
        />

        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11.5, color: A.inkMute }}>{filtered.length} of {customers.length}</div>
      </div>

      {/* Main scrollable area */}
      <div style={{ flex: 1, overflow: "auto", padding: "16px 24px" }}>
        {/* Stat strip */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, marginBottom: 14 }}>
          <StatCard label="Total customers"   value={customers.length} sub={`${customers.length - unassignedCount} assigned`} />
          <StatCard label="Areas"              value={totalAreas} sub="across all reps" />
          <StatCard label="Assigned to a rep"  value={customers.length - unassignedCount} accent={A.green} />
          <StatCard label="Unassigned"         value={unassignedCount} sub={unassignedCount > 0 ? "needs a rep" : "all good"} accent={unassignedCount > 0 ? A.danger : A.green} />
        </div>

        {/* Table — CSS grid so the columns line up with the header row */}
        <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
          <div style={{ display: "grid", gridTemplateColumns: "100px 2fr 1fr 1.2fr 80px", padding: "10px 16px", fontSize: 10.5, color: A.inkMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", borderBottom: `1px solid ${A.borderSoft}`, background: A.panelTint }}>
            <div>Account №</div>
            <div style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("customer_name")}>
              Customer {sortKey === "customer_name" && (sortAsc ? "↑" : "↓")}
            </div>
            <div style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("area")}>
              Area {sortKey === "area" && (sortAsc ? "↑" : "↓")}
            </div>
            <div style={{ cursor: "pointer", userSelect: "none" }} onClick={() => handleSort("rep")}>
              Assigned rep {sortKey === "rep" && (sortAsc ? "↑" : "↓")}
            </div>
            <div style={{ textAlign: "right" }}>Actions</div>
          </div>

          {loading ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={{ padding: "40px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>
              {customers.length === 0 ? "No customers yet — click Add customer to create one." : "No customers match your filters."}
            </div>
          ) : (
            filtered.map((c, i) => (
              <div key={c.id} style={{ display: "grid", gridTemplateColumns: "100px 2fr 1fr 1.2fr 80px", padding: "11px 16px", alignItems: "center", borderBottom: i < filtered.length - 1 ? `1px solid ${A.borderRow}` : "none", fontSize: 12.5 }}>
                <div style={{ fontFamily: A.mono, fontSize: 11, color: A.inkSoft }}>{c.account_number ? `#${c.account_number}` : "—"}</div>
                <button
                  onClick={() => navigate(`/admin/customer/${c.id}`)}
                  style={{ background: "transparent", border: "none", padding: 0, fontFamily: A.sans, fontSize: 12.5, fontWeight: 500, color: A.ink, textAlign: "left", cursor: "pointer" }}
                  onMouseEnter={(e) => { (e.target as HTMLElement).style.color = A.green; }}
                  onMouseLeave={(e) => { (e.target as HTMLElement).style.color = A.ink; }}
                >
                  {c.customer_name}
                </button>
                <div>{c.area ? <Tag tone="cream">{c.area}</Tag> : <span style={{ color: A.inkMute }}>—</span>}</div>
                <div style={{ color: customerRepMap[c.id] ? A.ink : A.inkMute, fontStyle: customerRepMap[c.id] ? "normal" : "italic" }}>
                  {customerRepMap[c.id] || "Unassigned"}
                </div>
                <div style={{ display: "flex", gap: 4, justifyContent: "flex-end" }}>
                  <button type="button" onClick={() => openEdit(c)} title="Edit" style={{ padding: 5, background: "transparent", border: "none", borderRadius: 5, color: A.inkSoft, cursor: "pointer" }}>
                    <Pencil size={14} />
                  </button>
                  <button type="button" onClick={() => setDeleteTarget(c)} title="Delete" style={{ padding: 5, background: "transparent", border: "none", borderRadius: 5, color: A.danger, cursor: "pointer" }}>
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

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
            <div>
              <Label>Area</Label>
              <div className="relative mt-1">
                <Input
                  ref={areaInputRef}
                  value={area}
                  onChange={(e) => { setArea(e.target.value); setAreaDropdownOpen(true); }}
                  onFocus={() => setAreaDropdownOpen(true)}
                  onBlur={() => setTimeout(() => setAreaDropdownOpen(false), 150)}
                  placeholder="e.g. Johannesburg North"
                  autoComplete="off"
                />
                {areaDropdownOpen && filteredAreas.length > 0 && (
                  <div className="absolute top-full left-0 right-0 z-50 mt-1 rounded-md border bg-popover text-popover-foreground shadow-md overflow-hidden">
                    <Command shouldFilter={false}>
                      <CommandList className="max-h-40">
                        {filteredAreas.map((opt) => (
                          <CommandItem
                            key={opt}
                            value={opt}
                            onSelect={() => { setArea(opt); setAreaDropdownOpen(false); areaInputRef.current?.blur(); }}
                          >
                            {opt}
                          </CommandItem>
                        ))}
                      </CommandList>
                    </Command>
                  </div>
                )}
              </div>
            </div>
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
    </div>
  );
}