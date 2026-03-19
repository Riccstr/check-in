import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { UserCog, Plus, Pencil, KeyRound, Trash2 } from "lucide-react";

export default function AdminReps() {
  const [reps, setReps] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [credDialogOpen, setCredDialogOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [surname, setSurname] = useState("");
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
    setEditId(null); setName(""); setSurname(""); setEmail(""); setPassword("");
    setDialogOpen(true);
  };

  const openEdit = (r: any) => {
    setEditId(r.id); setName(r.rep_name); setSurname(r.surname || ""); setEmail(r.email || ""); setPassword("");
    setDialogOpen(true);
  };

  const openCredentials = (r: any) => {
    setEditId(r.id); setName(r.rep_name); setSurname(r.surname || ""); setEmail(r.email || ""); setPassword("");
    setCredDialogOpen(true);
  };

  const save = async () => {
    if (!name.trim()) { toast.error("Name required"); return; }
    setSaving(true);

    if (editId) {
      const res = await supabase.functions.invoke("manage-rep-user", {
        body: { action: "update", rep_id: editId, rep_name: name.trim(), surname: surname.trim(), email: email.trim() || undefined, password: password || undefined },
      });
      if (res.error || res.data?.error) {
        toast.error(res.data?.error || res.error?.message || "Failed");
      } else {
        toast.success("Updated");
      }
    } else {
      const { error } = await supabase.from("reps").insert({ rep_name: name.trim(), surname: surname.trim() || null });
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
      body: { action: "create", rep_id: editId, email: email.trim(), password: password.trim(), rep_name: name.trim(), surname: surname.trim() },
    });

    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Failed");
    } else {
      toast.success("Login credentials created");
    }
    setSaving(false);
    setCredDialogOpen(false); fetchReps();
  };

  const deleteRep = async () => {
    if (!deleteTarget) return;
    const repId = deleteTarget.id;

    // 1. Delete schedule_items for all daily_schedules belonging to this rep
    const { data: schedules } = await supabase.from("daily_schedules").select("id").eq("rep_id", repId);
    if (schedules && schedules.length > 0) {
      const scheduleIds = schedules.map((s: any) => s.id);
      await supabase.from("schedule_items").delete().in("schedule_id", scheduleIds);
    }

    // 2. Delete daily_schedules for this rep
    await supabase.from("daily_schedules").delete().eq("rep_id", repId);

    // 3. Delete schedule_templates for this rep
    await supabase.from("schedule_templates").delete().eq("rep_id", repId);

    // 4. Delete customer_assignments for this rep
    await supabase.from("customer_assignments").delete().eq("rep_id", repId);

    // 5. Delete visits for this rep
    await supabase.from("visits").delete().eq("rep_id", repId);

    // 6. Unlink auth user if linked (don't delete the auth user — admin handles that separately)
    if (deleteTarget.user_id) {
      await supabase.from("reps").update({ user_id: null }).eq("id", repId);
    }

    // 7. Delete the rep record itself
    const { error } = await supabase.from("reps").delete().eq("id", repId);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`${deleteTarget.rep_name} deleted`);
    }

    setDeleteTarget(null);
    fetchReps();
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
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {reps.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium">{r.rep_name}</TableCell>
                  <TableCell>{r.surname || "—"}</TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEdit(r)} title="Edit"><Pencil className="h-4 w-4" /></Button>
                    {!r.user_id && (
                      <Button variant="ghost" size="icon" onClick={() => openCredentials(r)} title="Set login"><KeyRound className="h-4 w-4" /></Button>
                    )}
                    <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(r)} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4" /></Button>
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

      {/* Delete Confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete rep permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete <strong>{deleteTarget?.rep_name}</strong> and all associated schedules, assignments, and visit records. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={deleteRep} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
