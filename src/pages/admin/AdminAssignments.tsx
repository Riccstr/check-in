import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { Link2, Trash2, Filter } from "lucide-react";

export default function AdminAssignments() {
  const [reps, setReps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [selectedRep, setSelectedRep] = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState("");
  const [loading, setLoading] = useState(true);
  const [filterRep, setFilterRep] = useState("all");
  const [filterArea, setFilterArea] = useState("all");

  const fetchAll = async () => {
    setLoading(true);
    const [r, c, a] = await Promise.all([
      supabase.from("reps").select("*").eq("is_active", true).order("rep_name"),
      supabase.from("customers").select("*").eq("is_active", true).order("customer_name"),
      supabase.from("customer_assignments").select("*, reps(rep_name), customers(customer_name, area)").order("assigned_at", { ascending: false }),
    ]);
    setReps(r.data || []);
    setCustomers(c.data || []);
    setAssignments(a.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const assign = async () => {
    if (!selectedRep || !selectedCustomer) { toast.error("Select a rep and a customer"); return; }
    const { error } = await supabase.from("customer_assignments").upsert(
      [{ rep_id: selectedRep, customer_id: selectedCustomer }],
      { onConflict: "rep_id,customer_id" }
    );
    if (error) toast.error(error.message);
    else { toast.success("Customer assigned"); setSelectedCustomer(""); fetchAll(); }
  };

  const remove = async (id: string) => {
    await supabase.from("customer_assignments").delete().eq("id", id);
    toast.success("Removed"); fetchAll();
  };

  const areas = useMemo(() => {
    const set = new Set<string>();
    assignments.forEach((a: any) => { if (a.customers?.area) set.add(a.customers.area); });
    return Array.from(set).sort();
  }, [assignments]);

  const filteredAssignments = useMemo(() => {
    return assignments.filter((a: any) => {
      if (filterRep !== "all" && a.reps?.rep_name !== filterRep) return false;
      if (filterArea !== "all" && (a.customers?.area || "") !== filterArea) return false;
      return true;
    });
  }, [assignments, filterRep, filterArea]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-accent" /> Assign Customers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Rep</Label>
              <SearchableSelect
                value={selectedRep}
                onValueChange={setSelectedRep}
                options={reps.map((r) => ({ value: r.id, label: r.rep_name }))}
                placeholder="Select rep"
                searchPlaceholder="Search reps..."
                className="w-full"
              />
            </div>
            <div className="space-y-2">
              <Label>Customer</Label>
              <SearchableSelect
                value={selectedCustomer}
                onValueChange={setSelectedCustomer}
                options={customers.map((c) => ({ value: c.id, label: `${c.customer_name}${c.area ? ` (${c.area})` : ""}` }))}
                placeholder="Select customer"
                searchPlaceholder="Search customers..."
                className="w-full"
              />
            </div>
          </div>
          <Button onClick={assign} disabled={!selectedRep || !selectedCustomer}>
            Assign
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Filter className="h-5 w-5 text-muted-foreground" /> Current Assignments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3 mb-4">
            <SearchableSelect
              value={filterRep}
              onValueChange={setFilterRep}
              options={reps.map((r) => ({ value: r.rep_name, label: r.rep_name }))}
              placeholder="All Reps"
              searchPlaceholder="Search reps..."
              includeAll
              allLabel="All Reps"
              className="w-[180px]"
            />
            <Select value={filterArea} onValueChange={setFilterArea}>
              <SelectTrigger className="w-[180px]"><SelectValue placeholder="Filter by area" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Areas</SelectItem>
                {areas.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          {loading ? <p className="text-muted-foreground py-4">Loading...</p> : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rep</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Area</TableHead>
                  <TableHead>Assigned</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredAssignments.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.reps?.rep_name}</TableCell>
                    <TableCell>{a.customers?.customer_name}</TableCell>
                    <TableCell className="text-muted-foreground">{a.customers?.area || "—"}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{new Date(a.assigned_at).toLocaleDateString()}</TableCell>
                    <TableCell><Button variant="ghost" size="icon" onClick={() => remove(a.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
