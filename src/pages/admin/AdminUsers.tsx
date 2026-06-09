import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Trash2, UserPlus, Pencil, Info } from "lucide-react";
import { format } from "date-fns";
import { A, PageHeader, Tag, PrimaryButton } from "@/lib/adminUi";

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

function UserTable({
  title,
  subtitle,
  users,
  showLinkedRep,
  onEdit,
  onDelete,
  emptyCopy,
}: {
  title: string;
  subtitle: string;
  users: UserAccount[];
  showLinkedRep: boolean;
  onEdit: (u: UserAccount) => void;
  onDelete: (u: UserAccount) => void;
  emptyCopy: string;
}) {
  // 6 cols when showing linked rep, 5 cols otherwise. Adjust grid template per case.
  const cols = showLinkedRep ? "1.6fr 1.6fr 1.2fr 0.9fr 1fr 60px" : "1.6fr 1.6fr 0.9fr 1fr 60px";

  return (
    <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", padding: "14px 18px", borderBottom: `1px solid ${A.border}` }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{title}</div>
          <div style={{ fontSize: 12, color: A.inkMute, marginTop: 2 }}>{subtitle}</div>
        </div>
        <div style={{ fontFamily: A.mono, fontSize: 11.5, color: A.inkMute }}>{users.length} {users.length === 1 ? "user" : "users"}</div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: cols, padding: "8px 18px", fontSize: 10.5, color: A.inkMute, fontWeight: 600, letterSpacing: 0.4, textTransform: "uppercase", borderBottom: `1px solid ${A.borderSoft}`, background: A.panelTint }}>
        <div>Name</div>
        <div>Email</div>
        {showLinkedRep && <div>Linked rep</div>}
        <div>Created</div>
        <div>Last sign-in</div>
        <div></div>
      </div>

      {users.length === 0 ? (
        <div style={{ padding: "40px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>{emptyCopy}</div>
      ) : users.map((u, i) => {
        const fullName = u.full_name
          || [u.linked_rep_first_name, u.linked_rep_surname].filter(Boolean).join(" ")
          || u.email.split("@")[0];
        const initials = fullName.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "U";
        const isAdmin = u.role === "admin";
        const isPending = !u.role;
        return (
          <div
            key={u.id}
            style={{
              display: "grid",
              gridTemplateColumns: cols,
              padding: "12px 18px",
              alignItems: "center",
              borderBottom: i < users.length - 1 ? `1px solid ${A.borderRow}` : "none",
              fontSize: 12.5,
              color: isPending ? A.inkMute : A.ink,
            }}
          >
            {/* Name + initials avatar + role tag */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
              <div style={{ width: 30, height: 30, borderRadius: 999, background: isAdmin ? A.greenDeep : A.greenSoft, color: isAdmin ? A.cream : A.green, fontSize: 11, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>{initials}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 500, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{fullName}</div>
                <div style={{ display: "flex", gap: 4, marginTop: 2 }}>
                  {isAdmin && <Tag tone="green">Admin</Tag>}
                  {!isAdmin && !isPending && <Tag tone="cream">Rep</Tag>}
                  {isPending && <Tag tone="sun">No role</Tag>}
                </div>
              </div>
            </div>

            {/* Email + login-change footnote */}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontFamily: A.mono, fontSize: 11.5, color: A.inkSoft, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{u.email}</div>
              {u.login_updated_at && (
                <div style={{ fontSize: 10, color: A.inkMute, marginTop: 2, display: "inline-flex", alignItems: "center", gap: 4 }}>
                  <Info size={10} />
                  Login changed {format(new Date(u.login_updated_at), "dd MMM HH:mm")}
                  {u.login_updated_by_name && ` by ${u.login_updated_by_name}`}
                </div>
              )}
            </div>

            {/* Linked rep (rep table only) */}
            {showLinkedRep && (
              <div style={{ fontSize: 12, color: u.linked_rep_name ? A.ink : A.inkMute, fontStyle: u.linked_rep_name ? "normal" : "italic" }}>
                {u.linked_rep_name || "Not linked"}
              </div>
            )}

            {/* Created */}
            <div style={{ fontFamily: A.mono, fontSize: 11, color: A.inkMute }}>
              {format(new Date(u.created_at), "dd MMM yyyy")}
            </div>

            {/* Last sign-in */}
            <div style={{ fontSize: 11.5, color: u.last_sign_in_at ? A.inkSoft : A.inkMute, fontStyle: u.last_sign_in_at ? "normal" : "italic" }}>
              {u.last_sign_in_at ? format(new Date(u.last_sign_in_at), "dd MMM HH:mm") : "Never"}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 2 }}>
              <button type="button" onClick={() => onEdit(u)} title="Edit" style={{ padding: 5, background: "transparent", border: "none", color: A.inkSoft, cursor: "pointer" }}>
                <Pencil size={13} />
              </button>
              <button type="button" onClick={() => onDelete(u)} title="Delete" style={{ padding: 5, background: "transparent", border: "none", color: A.danger, cursor: "pointer" }}>
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
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

  // Split admins from reps for the redesign's two-table layout.
  // Users with role === null fall into a third "Pending" bucket inside the rep table.
  const admins = users.filter((u) => u.role === "admin");
  const reps   = users.filter((u) => u.role !== "admin");

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: A.bg, minHeight: 0, fontFamily: A.sans, color: A.ink }}>
      <PageHeader
        title="Users"
        subtitle={`${admins.length} ${admins.length === 1 ? "admin" : "admins"} · ${reps.length} ${reps.length === 1 ? "rep" : "reps"}`}
        right={
          <PrimaryButton icon={<UserPlus size={13} />} onClick={openCreateDialog}>Add User</PrimaryButton>
        }
      />

      <div style={{ flex: 1, overflow: "auto", padding: "20px 24px" }}>
        {loading ? (
          <div style={{ padding: "60px 16px", textAlign: "center", color: A.inkMute, fontSize: 13 }}>Loading…</div>
        ) : (
          <>
            <UserTable
              title="Administrators"
              subtitle="Full access — schedules, exports, users."
              users={admins}
              showLinkedRep={false}
              onEdit={openEditDialog}
              onDelete={openDeleteDialog}
              emptyCopy="No admin users yet."
            />

            <div style={{ height: 18 }} />

            <UserTable
              title="Field reps & pending"
              subtitle="App users — assigned to a rep record and see only their assigned customers."
              users={reps}
              showLinkedRep={true}
              onEdit={openEditDialog}
              onDelete={openDeleteDialog}
              emptyCopy="No rep users yet."
            />
          </>
        )}
      </div>

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
    </div>
  );
}