import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Users, Plus, Pencil } from "lucide-react";

export default function AdminCustomers() {
  const [customers, setCustomers] = useState<any[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");

  const fetch = async () => {
    setLoading(true);
    const { data } = await supabase.from("customers").select("*").order("customer_name");
    setCustomers(data || []);
    setLoading(false);
  };

  useEffect(() => { fetch(); }, []);

  const openNew = () => { setEditId(null); setName(""); setDialogOpen(true); };
  const openEdit = (c: any) => { setEditId(c.id); setName(c.customer_name); setDialogOpen(true); };

  const save = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    if (editId) {
      const { error } = await supabase.from("customers").update({ customer_name: name.trim() }).eq("id", editId);
      if (error) toast.error(error.message); else toast.success("Updated");
    } else {
      const { error } = await supabase.from("customers").insert({ customer_name: name.trim() });
      if (error) toast.error(error.message); else toast.success("Created");
    }
    setDialogOpen(false); fetch();
  };

  const toggleActive = async (c: any) => {
    await supabase.from("customers").update({ is_active: !c.is_active }).eq("id", c.id);
    toast.success(c.is_active ? "Deactivated" : "Reactivated"); fetch();
  };

  const filtered = customers.filter((c) => c.customer_name.toLowerCase().includes(search.toLowerCase()));

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
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {filtered.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.customer_name}</TableCell>
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
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
