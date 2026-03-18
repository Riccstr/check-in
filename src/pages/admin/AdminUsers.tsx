import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Users, Trash2, UserPlus, Pencil, Info } from "lucide-react";
import { format } from "date-fns";

interface UserAccount {
  id: string;
  email: string;
  full_name: string | null;
  role: string | null;
  role_id: string | null;
  linked_rep_id: string | null;
  linked_rep_name: string | null;
  linked_rep_first_name: string | null;
  linked_rep_surname: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
  login_updated_at: string | null;
  login_updated_by_name: string | null;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);
  const [saving, setSaving] = useState(false);

  // Create user form state
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createFirstName, setCreateFirstName] = useState("");
  const [createSurname, setCreateSurname] = useState("");
  const [createRole, setCreateRole] = useState("rep");

  // Edit user form state
  const [editFirstName, setEditFirstName] = useState("");
  const [editSurname, setEditSurname] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editRole, setEditRole] = useState("rep");

  const fetchUsers = async () => {
    setLoading(true);
    const res = await supabase.functions.invoke("manage-users", {
      body: { action: "list" },
    });
    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Failed to load users");
    } else {
      setUsers(res.data.users || []);
    }
    setLoading(false);
  };

  useEffect(() => { fetchUsers(); }, []);

  const openCreateDialog = () => {
    setCreateEmail("");
    setCreatePassword("");
    setCreateFirstName("");
    setCreateSurname("");
    setCreateRole("rep");
    setCreateDialogOpen(true);
  };

  const createUser = async () => {
    if (!createEmail.trim() || !createPassword.trim()) {
      toast.error("Email and password are required");
      return;
    }
    if (createPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSaving(true);
    const res = await supabase.functions.invoke("manage-users", {
      body: {
        action: "create_user",
        email: createEmail.trim(),
        password: createPassword,
        role: createRole,
        first_name: createFirstName.trim(),
        surname: createSurname.trim(),
      },
    });
    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Failed to create user");
    } else {
      toast.success("User created successfully");
      setCreateDialogOpen(false);
      fetchUsers();
    }
    setSaving(false);
  };

  const openEditDialog = (u: UserAccount) => {
    setSelectedUser(u);
    // Prefer linked rep's individual fields; fall back to parsing full_name
    if (u.linked_rep_first_name !== null || u.linked_rep_surname !== null) {
      setEditFirstName(u.linked_rep_first_name || "");
      setEditSurname(u.linked_rep_surname || "");
    } else {
      const parts = (u.full_name || "").split(" ");
      setEditFirstName(parts[0] || "");
      setEditSurname(parts.slice(1).join(" ") || "");
    }
    setEditEmail(u.email);
    setEditPassword("");
    setEditRole(u.role || "rep");
    setEditDialogOpen(true);
  };

  const saveEdit = async () => {
    if (!selectedUser) return;
    if (!editEmail.trim()) {
      toast.error("Email is required");
      return;
    }
    if (editPassword && editPassword.length < 6) {
      toast.error("Password must be at least 6 characters");
      return;
    }
    setSaving(true);
    const body: Record<string, string> = {
      action: "update_user",
      user_id: selectedUser.id,
      first_name: editFirstName.trim(),
      surname: editSurname.trim(),
      email: editEmail.trim(),
      role: editRole,
    };
    if (editPassword) body.password = editPassword;
    const res = await supabase.functions.invoke("manage-users", { body });
    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Failed to save changes");
    } else {
      toast.success("User updated");
      setEditDialogOpen(false);
      fetchUsers();
    }
    setSaving(false);
  };

  const openDeleteDialog = (u: UserAccount) => {
    setSelectedUser(u);
    setDeleteDialogOpen(true);
  };

  const deleteUser = async () => {
    if (!selectedUser) return;
    setSaving(true);
    const res = await supabase.functions.invoke("manage-users", {
      body: { action: "delete_user", user_id: selectedUser.id },
    });
    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Failed");
    } else {
      toast.success("User deleted");
    }
    setSaving(false);
    setDeleteDialogOpen(false);
    fetchUsers();
  };

  const roleBadgeVariant = (role: string | null) => {
    if (role === "admin") return "destructive" as const;
    if (role === "rep") return "default" as const;
    return "secondary" as const;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5 text-accent" /> User Accounts
          </CardTitle>
          <Button onClick={openCreateDialog} size="sm">
            <UserPlus className="h-4 w-4 mr-2" /> Add User
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="text-muted-foreground py-4">Loading...</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Email</TableHead>
                <TableHead>Name</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Linked Rep</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Last Sign In</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((u) => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div className="font-medium">{u.email}</div>
                    {u.login_updated_at && (
                      <div className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1">
                        <Info className="h-3 w-3" />
                        Login changed {format(new Date(u.login_updated_at), "dd MMM yyyy HH:mm")}
                        {u.login_updated_by_name && <> by {u.login_updated_by_name}</>}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>{u.full_name || "—"}</TableCell>
                  <TableCell>
                    <Badge variant={roleBadgeVariant(u.role)}>
                      {u.role || "none"}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.linked_rep_name || "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {format(new Date(u.created_at), "dd MMM yyyy")}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {u.last_sign_in_at
                      ? format(new Date(u.last_sign_in_at), "dd MMM yyyy HH:mm")
                      : "Never"}
                  </TableCell>
                  <TableCell className="text-right space-x-1">
                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(u)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(u)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {/* Create User Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add New User</DialogTitle>
            <DialogDescription>Create a new user account with role assignment.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name</Label>
                <Input value={createFirstName} onChange={(e) => setCreateFirstName(e.target.value)} placeholder="First name" />
              </div>
              <div>
                <Label>Surname</Label>
                <Input value={createSurname} onChange={(e) => setCreateSurname(e.target.value)} placeholder="Surname" />
              </div>
            </div>
            <div>
              <Label>Email *</Label>
              <Input type="email" value={createEmail} onChange={(e) => setCreateEmail(e.target.value)} placeholder="user@example.com" />
            </div>
            <div>
              <Label>Password *</Label>
              <Input type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} placeholder="Min 6 characters" />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={createRole} onValueChange={setCreateRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="rep">Rep</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancel</Button>
            <Button onClick={createUser} disabled={saving}>{saving ? "Creating..." : "Create User"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit User Dialog */}
      <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update details for {selectedUser?.email}.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>First Name</Label>
                <Input value={editFirstName} onChange={(e) => setEditFirstName(e.target.value)} placeholder="First name" />
              </div>
              <div>
                <Label>Surname</Label>
                <Input value={editSurname} onChange={(e) => setEditSurname(e.target.value)} placeholder="Surname" />
              </div>
            </div>
            <div>
              <Label>Email *</Label>
              <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="user@example.com" />
            </div>
            <div>
              <Label>New Password</Label>
              <Input type="password" value={editPassword} onChange={(e) => setEditPassword(e.target.value)} placeholder="Leave blank to keep current" />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={editRole} onValueChange={setEditRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="rep">Rep</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditDialogOpen(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete User</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete <strong>{selectedUser?.email}</strong>? This action cannot be undone. The user will be unlinked from any rep record.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialogOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={deleteUser} disabled={saving}>
              {saving ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
