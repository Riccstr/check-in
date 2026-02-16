import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import { Link2, Trash2 } from "lucide-react";

export default function AdminAssignments() {
  const [reps, setReps] = useState<any[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [selectedRep, setSelectedRep] = useState("");
  const [selectedCustomers, setSelectedCustomers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = async () => {
    setLoading(true);
    const [r, c, a] = await Promise.all([
      supabase.from("reps").select("*").eq("is_active", true).order("rep_name"),
      supabase.from("customers").select("*").eq("is_active", true).order("customer_name"),
      supabase.from("customer_assignments").select("*, reps(rep_name), customers(customer_name)").order("assigned_at", { ascending: false }),
    ]);
    setReps(r.data || []);
    setCustomers(c.data || []);
    setAssignments(a.data || []);
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const assign = async () => {
    if (!selectedRep || selectedCustomers.length === 0) { toast.error("Select a rep and at least one customer"); return; }
    const inserts = selectedCustomers.map((cid) => ({ rep_id: selectedRep, customer_id: cid }));
    const { error } = await supabase.from("customer_assignments").upsert(inserts, { onConflict: "rep_id,customer_id" });
    if (error) toast.error(error.message);
    else { toast.success(`Assigned ${selectedCustomers.length} customer(s)`); setSelectedCustomers([]); fetchAll(); }
  };

  const remove = async (id: string) => {
    await supabase.from("customer_assignments").delete().eq("id", id);
    toast.success("Removed"); fetchAll();
  };

  const toggleCustomer = (id: string) => {
    setSelectedCustomers((prev) => prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]);
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5 text-accent" /> Assign Customers</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Rep</Label>
            <Select value={selectedRep} onValueChange={setSelectedRep}>
              <SelectTrigger className="max-w-xs"><SelectValue placeholder="Select rep" /></SelectTrigger>
              <SelectContent>{reps.map((r) => <SelectItem key={r.id} value={r.id}>{r.rep_name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Customers</Label>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-48 overflow-y-auto border rounded-md p-3">
              {customers.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox checked={selectedCustomers.includes(c.id)} onCheckedChange={() => toggleCustomer(c.id)} />
                  {c.customer_name}
                </label>
              ))}
            </div>
          </div>
          <Button onClick={assign} disabled={!selectedRep || selectedCustomers.length === 0}>
            Assign Selected
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Current Assignments</CardTitle></CardHeader>
        <CardContent>
          {loading ? <p className="text-muted-foreground py-4">Loading...</p> : (
            <Table>
              <TableHeader><TableRow><TableHead>Rep</TableHead><TableHead>Customer</TableHead><TableHead>Assigned</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {assignments.map((a: any) => (
                  <TableRow key={a.id}>
                    <TableCell>{a.reps?.rep_name}</TableCell>
                    <TableCell>{a.customers?.customer_name}</TableCell>
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
