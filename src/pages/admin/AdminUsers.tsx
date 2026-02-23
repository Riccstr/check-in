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
import { Users, Shield, KeyRound, Trash2, UserPlus } from "lucide-react";
import { format } from "date-fns";

interface UserAccount {
  id: string;
  email: string;
  full_name: string | null;
  role: string | null;
  role_id: string | null;
  linked_rep_id: string | null;
  linked_rep_name: string | null;
  created_at: string;
  last_sign_in_at: string | null;
  email_confirmed_at: string | null;
}

export default function AdminUsers() {
  const [users, setUsers] = useState<UserAccount[]>([]);
  const [loading, setLoading] = useState(true);

  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [roleDialogOpen, setRoleDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [selectedUser, setSelectedUser] = useState<UserAccount | null>(null);
  const [selectedRole, setSelectedRole] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  // Create user form state
  const [createEmail, setCreateEmail] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createFullName, setCreateFullName] = useState("");
  const [createSurname, setCreateSurname] = useState("");
  const [createRole, setCreateRole] = useState("rep");

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
    setCreateFullName("");
    setCreateSurname("");
    setCreateRole("rep");
    setCreateDialogOpen(true);
  };

  const createUser = async () => {
    if (!createEmail.trim() || !createPassword.trim()) {
      toast.error("Email and password are required");
      return;
    }
    if (createPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setSaving(true);
    const fullName = [createFullName.trim(), createSurname.trim()].filter(Boolean).join(" ") || createEmail;
    const res = await supabase.functions.invoke("manage-users", {
      body: {
        action: "create_user",
        email: createEmail.trim(),
        password: createPassword,
        role: createRole,
        full_name: fullName,
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

  const openRoleDialog = (u: UserAccount) => {
    setSelectedUser(u);
    setSelectedRole(u.role || "rep");
    setRoleDialogOpen(true);
  };

  const openPasswordDialog = (u: UserAccount) => {
    setSelectedUser(u);
    setNewPassword("");
    setPasswordDialogOpen(true);
  };

  const openDeleteDialog = (u: UserAccount) => {
    setSelectedUser(u);
    setDeleteDialogOpen(true);
  };

  const saveRole = async () => {
    if (!selectedUser) return;
    setSaving(true);
    const res = await supabase.functions.invoke("manage-users", {
      body: { action: "update_role", user_id: selectedUser.id, role: selectedRole },
    });
    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Failed");
    } else {
      toast.success("Role updated");
    }
    setSaving(false);
    setRoleDialogOpen(false);
    fetchUsers();
  };

  const resetPassword = async () => {
    if (!selectedUser || !newPassword.trim()) {
      toast.error("Password required");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }
    setSaving(true);
    const res = await supabase.functions.invoke("manage-users", {
      body: { action: "reset_password", user_id: selectedUser.id, password: newPassword },
    });
    if (res.error || res.data?.error) {
      toast.error(res.data?.error || res.error?.message || "Failed");
    } else {
      toast.success("Password reset");
    }
    setSaving(false);
    setPasswordDialogOpen(false);
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
                  <TableCell className="font-medium">{u.email}</TableCell>
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
                    <Button variant="ghost" size="icon" onClick={() => openRoleDialog(u)} title="Change role">
                      <Shield className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openPasswordDialog(u)} title="Reset password">
                      <KeyRound className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => openDeleteDialog(u)} title="Delete user">
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
                <Input value={createFullName} onChange={(e) => setCreateFullName(e.target.value)} placeholder="First name" />
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
              <Input type="password" value={createPassword} onChange={(e) => setCreatePassword(e.target.value)} placeholder="Min 8 characters" />
            </div>
            <div>
              <Label>Role</Label>
              <Select value={createRole} onValueChange={setCreateRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
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

      {/* Role Dialog */}
      <Dialog open={roleDialogOpen} onOpenChange={setRoleDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Role</DialogTitle>
            <DialogDescription>Update the role for {selectedUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Role</Label>
              <Select value={selectedRole} onValueChange={setSelectedRole}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="rep">Rep</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={saveRole} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Password Dialog */}
      <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reset Password</DialogTitle>
            <DialogDescription>Set a new password for {selectedUser?.email}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>New Password</Label>
              <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} placeholder="Min 8 characters" />
            </div>
          </div>
          <DialogFooter>
            <Button onClick={resetPassword} disabled={saving}>{saving ? "Resetting..." : "Reset Password"}</Button>
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
