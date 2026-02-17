import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Settings } from "lucide-react";

export default function AdminAccount() {
  const { user } = useAuth();
  const [email, setEmail] = useState(user?.email || "");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);

  const updateEmail = async () => {
    if (!email.trim()) { toast.error("Email required"); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ email: email.trim() });
    if (error) toast.error(error.message);
    else toast.success("Email update initiated. Check your inbox to confirm.");
    setSaving(false);
  };

  const updatePassword = async () => {
    if (!password || password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (password !== confirmPassword) { toast.error("Passwords do not match"); return; }
    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) toast.error(error.message);
    else { toast.success("Password updated"); setPassword(""); setConfirmPassword(""); }
    setSaving(false);
  };

  return (
    <div className="space-y-6 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Settings className="h-5 w-5 text-accent" /> Account Settings</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <Button onClick={updateEmail} disabled={saving || email === user?.email}>Update Email</Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Change Password</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label>New Password</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" />
          </div>
          <div>
            <Label>Confirm Password</Label>
            <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
          </div>
          <Button onClick={updatePassword} disabled={saving || !password}>Update Password</Button>
        </CardContent>
      </Card>
    </div>
  );
}
