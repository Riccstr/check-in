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
import { UserCog, Plus, Pencil, KeyRound } from "lucide-react";

export default function AdminReps() {
  const [reps, setReps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [credDialogOpen, setCredDialogOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
  const [cellNo, setCellNo] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const fetchReps = async () => {
    setLoading(true);
    const { data } = await supabase.from("reps").select("*").order("rep_name");
    setReps(data || []);
    setLoading(false);
  };

  useEffect(() => { fetchReps(); }, []);

  const openNew = () => {
    setEditId(null); setName(""); setSurname(""); setCellNo(""); setEmail(""); setPassword("");
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditId(r.id); setName(r.rep_name); setSurname(r.surname || ""); setCellNo(r.cell_no || ""); setEmail(r.email || ""); setPassword("");
    setDialogOpen(true);
  };

  const openCredentials = (r: any) => {
    setEditId(r.id); setName(r.rep_name); setSurname(r.surname || ""); setCellNo(r.cell_no || ""); setEmail(r.email || ""); setPassword("");
    setCredDialogOpen(true);
  };

  const save = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    setSaving(true);

    if (editId) {
      // Update rep details via edge function
      const { data: { session } } = await supabase.auth.getSession();
      const res = await supabase.functions.invoke("manage-rep-user", {
        body: { action: "update", rep_id: editId, rep_name: name.trim(), surname: surname.trim(), cell_no: cellNo.trim(), email: email.trim() || undefined, password: password || undefined },
      });
      if (res.error || res.data?.error) {
        toast.error(res.data?.error || res.error?.message || "Failed");
      } else {
        toast.success("Updated");
      }
    } else {
      const { error } = await supabase.from("reps").insert({ rep_name: name.trim(), surname: surname.trim() || null, cell_no: cellNo.trim() || null, email: email.trim() || null });
      if (error) toast.error(error.message); else toast.success("Created");
    }
    setSaving(false);
    setDialogOpen(false); fetchReps();
  };

  const saveCredentials = async () => {
    if (!editId || !email.trim() || !password.trim()) {
      toast.error("Email and password required");
      return;
    }
    setSaving(true);

    const res = await supabase.functions.invoke("manage-rep-user", {
      body: { action: "create", rep_id: editId, email: email.trim(), password: password.trim(), rep_name: name.trim(), surname: surname.trim(), cell_no: cellNo.trim() },
    });

    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Failed");
    } else {
      toast.success("Login credentials created");
    }
    setSaving(false);
    setCredDialogOpen(false); fetchReps();
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
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Surname</TableHead>
                <TableHead>Cell No</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reps.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.rep_name}</TableCell>
                  <TableCell>{r.surname || "—"}</TableCell>
                  <TableCell>{r.cell_no || "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">{r.email || "No login"}</TableCell>
                  <TableCell><Badge variant={r.is_active ? "default" : "secondary"}>{r.is_active ? "Active" : "Inactive"}</Badge></TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                    {!r.user_id && (
                      <Button variant="ghost" size="icon" onClick={() => openCredentials(r)} title="Set login"><KeyRound className="h-4 w-4" /></Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(r)}>{r.is_active ? "Deactivate" : "Reactivate"}</Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editId ? "Edit" : "Add"} Rep</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Name *</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div><Label>Surname</Label><Input value={surname} onChange={(e) => setSurname(e.target.value)} /></div>
            <div><Label>Cell No</Label><Input value={cellNo} onChange={(e) => setCellNo(e.target.value)} /></div>
            {editId && (
              <>
                <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
                <div><Label>New Password (leave blank to keep)</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
              </>
            )}
          </div>
          <DialogFooter><Button onClick={save} disabled={saving}>{saving ? "Saving..." : "Save"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Credentials Dialog */}
      <Dialog open={credDialogOpen} onOpenChange={setCredDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Set Login for {name}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label>Email *</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label>Password *</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" /></div>
          </div>
          <DialogFooter><Button onClick={saveCredentials} disabled={saving}>{saving ? "Creating..." : "Create Login"}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
