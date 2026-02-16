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
import { UserCog, Plus, Pencil } from "lucide-react";

export default function AdminReps() {
  const [reps, setReps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");

  const fetchReps = async () => {
    setLoading(true);
    const { data } = await supabase.from("reps").select("*").order("rep_name");
    setReps(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchReps(); }, []);

  const openNew = () => { setEditId(null); setName(""); setDialogOpen(true); };
  const openEdit = (r: any) => { setEditId(r.id); setName(r.rep_name); setDialogOpen(true); };

  const save = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    if (editId) {
      const { error } = await supabase.from("reps").update({ rep_name: name.trim() }).eq("id", editId);
      if (error) toast.error(error.message); else toast.success("Updated");
    } else {
      const { error } = await supabase.from("reps").insert({ rep_name: name.trim() });
      if (error) toast.error(error.message); else toast.success("Created");
    }
    setDialogOpen(false); fetchReps();
  };

  const toggleActive = async (r: any) => {
    await supabase.from("reps").update({ is_active: !r.is_active }).eq("id", r.id);
    toast.success(r.is_active ? "Deactivated" : "Reactivated"); fetchReps();
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2"><UserCog className="h-5 w-5 text-accent" /> Reps</CardTitle>
        <Button size="sm" onClick={openNew}><Plus className="h-4 w-4 mr-1" /> Add</Button>
      </CardHeader>
      <CardContent>
        {loading ? <p className="text-muted-foreground py-4">Loading...</p> : (
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Linked User</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
            <TableBody>
              {reps.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.rep_name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.user_id ? "✓ Linked" : "Not linked"}</TableCell>
                  <TableCell><Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)}><Pencil className="h-4 w-4" /></Button>
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(r)}>{r.is_active ? "Deactivate" : "Reactivate"}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Rep</DialogTitle></DialogHeader>
          <div><Label>Name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <DialogFooter><Button onClick={save}>Save</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
