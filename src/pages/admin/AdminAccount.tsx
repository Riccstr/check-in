import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Mail, Lock, Shield, Laptop, LogOut } from "lucide-react";
import { A, PageHeader, Tag, PrimaryButton, GhostButton } from "@/lib/adminUi";

function SignOutButton() {
  const { signOut } = useAuth();
  return (
    <button
      type="button"
      onClick={() => signOut()}
      style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", background: A.panel, color: A.danger, border: `1px solid ${A.dangerBg}`, borderRadius: 7, fontSize: 11.5, fontWeight: 600, fontFamily: A.sans, cursor: "pointer" }}
    >
      <LogOut size={12} /> Sign out
    </button>
  );
}

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

  // Display strings derived from the current user.
  const displayName = user?.user_metadata?.full_name
    || (user?.email ? user.email.split("@")[0] : "Admin");
  const initials = displayName.split(/\s+/).map((w) => w[0]).filter(Boolean).slice(0, 2).join("").toUpperCase() || "A";

  // Password strength — naive but useful as a UX cue. Pure derivation, no state.
  const pwStrength: { score: 0 | 1 | 2 | 3 | 4; label: string; colour: string } = (() => {
    if (!password) return { score: 0, label: "—", colour: A.inkDim };
    let s = 0;
    if (password.length >= 6)  s++;
    if (password.length >= 10) s++;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s++;
    if (/[0-9]/.test(password) || /[^A-Za-z0-9]/.test(password)) s++;
    const labels = ["Too short", "Weak", "Fair", "Good", "Strong"];
    const colours = [A.danger, A.danger, A.sun, A.greenMid, A.green];
    return { score: s as 0 | 1 | 2 | 3 | 4, label: labels[s], colour: colours[s] };
  })();

  return (
    <div style={{ flex: 1, display: "flex", flexDirection: "column", background: A.bg, minHeight: 0, fontFamily: A.sans, color: A.ink }}>
      <PageHeader
        title="Account"
        subtitle="Your login, security and active sessions"
      />

      <div style={{ flex: 1, overflow: "auto", padding: "22px 28px" }}>
        <div style={{ maxWidth: 760, display: "flex", flexDirection: "column", gap: 14 }}>

          {/* ── Profile card ──────────────────────────────────────────── */}
          <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, padding: "18px 20px", display: "flex", alignItems: "center", gap: 16 }}>
            <div style={{ width: 56, height: 56, borderRadius: 999, background: A.greenDeep, color: A.cream, fontSize: 18, fontWeight: 600, display: "flex", alignItems: "center", justifyContent: "center" }}>{initials}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 16, fontWeight: 600, color: A.ink, letterSpacing: -0.2 }}>{displayName}</div>
              <div style={{ fontSize: 12, color: A.inkMute, marginTop: 3, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Tag tone="green">Admin</Tag>
                <span style={{ fontFamily: A.mono }}>{user?.email}</span>
              </div>
              {user?.last_sign_in_at && (
                <div style={{ fontSize: 11, color: A.inkMute, marginTop: 6, fontFamily: A.mono }}>
                  Last sign-in {new Date(user.last_sign_in_at).toLocaleString("en-ZA", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              )}
            </div>
          </div>

          {/* ── Email + Password (side-by-side on desktop) ─────────────── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

            {/* Email */}
            <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                <Mail size={14} style={{ color: A.green }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>Email address</div>
              </div>
              <div style={{ fontSize: 11.5, color: A.inkMute, marginBottom: 14 }}>We'll send a confirmation link to the new address before switching.</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                <div>
                  <Label htmlFor="acct-email" style={{ fontSize: 11, fontWeight: 600, color: A.inkSoft, letterSpacing: 0.3, textTransform: "uppercase" }}>Email</Label>
                  <Input id="acct-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} style={{ height: 34, fontSize: 12.5, fontFamily: A.mono, background: A.panel, borderColor: A.border, marginTop: 5 }} />
                </div>
              </div>

              <div style={{ marginTop: 14 }}>
                <PrimaryButton onClick={updateEmail} disabled={saving || email === user?.email}>
                  {saving ? "Saving…" : "Update email"}
                </PrimaryButton>
              </div>
            </div>

            {/* Password */}
            <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, padding: "16px 18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 4 }}>
                <Lock size={14} style={{ color: A.green }} />
                <div style={{ fontSize: 13, fontWeight: 600 }}>Password</div>
              </div>
              <div style={{ fontSize: 11.5, color: A.inkMute, marginBottom: 14 }}>6 characters minimum, mix of letters and numbers recommended.</div>

              <div style={{ display: "flex", flexDirection: "column", gap: 11 }}>
                <div>
                  <Label htmlFor="acct-pw1" style={{ fontSize: 11, fontWeight: 600, color: A.inkSoft, letterSpacing: 0.3, textTransform: "uppercase" }}>New password</Label>
                  <Input id="acct-pw1" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Min 6 characters" style={{ height: 34, fontSize: 12.5, background: A.panel, borderColor: A.border, marginTop: 5 }} />
                </div>
                <div>
                  <Label htmlFor="acct-pw2" style={{ fontSize: 11, fontWeight: 600, color: A.inkSoft, letterSpacing: 0.3, textTransform: "uppercase" }}>Confirm password</Label>
                  <Input id="acct-pw2" type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} style={{ height: 34, fontSize: 12.5, background: A.panel, borderColor: A.border, marginTop: 5 }} />
                </div>

                {/* Strength meter */}
                {password && (
                  <div>
                    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 4 }}>
                      <div style={{ fontSize: 10.5, color: A.inkMute, fontWeight: 500 }}>Strength</div>
                      <div style={{ fontSize: 10.5, color: pwStrength.colour, fontWeight: 600 }}>{pwStrength.label}</div>
                    </div>
                    <div style={{ display: "flex", gap: 3 }}>
                      {[1, 2, 3, 4].map((s) => (
                        <div key={s} style={{ flex: 1, height: 4, borderRadius: 2, background: s <= pwStrength.score ? pwStrength.colour : A.borderSoft }} />
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <div style={{ marginTop: 14 }}>
                <PrimaryButton onClick={updatePassword} disabled={saving || !password}>
                  {saving ? "Saving…" : "Update password"}
                </PrimaryButton>
              </div>
            </div>
          </div>

          {/* ── 2FA + Active sessions ──────────────────────────────────── */}
          {/* SCOPE: This is a UI-only surface. The next sprint hooks it up via
              supabase.auth.mfa.enroll() etc. Don't fake the state — just render
              the surface and TODO the handlers. */}
          <div style={{ background: A.panel, border: `1px solid ${A.border}`, borderRadius: 10, overflow: "hidden" }}>
            <div style={{ padding: "14px 18px", borderBottom: `1px solid ${A.border}`, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <div>
                <div style={{ display: "flex", alignItems: "center", gap: 9, marginBottom: 3 }}>
                  <Shield size={14} style={{ color: A.green }} />
                  <div style={{ fontSize: 13, fontWeight: 600 }}>Two-factor authentication</div>
                  <Tag tone="sun">Coming soon</Tag>
                </div>
                <div style={{ fontSize: 11.5, color: A.inkMute, marginLeft: 23 }}>Once enabled, sign-in will require a code from your authenticator app.</div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <GhostButton onClick={() => { /* TODO: hook up via supabase.auth.mfa.listFactors + .enroll */ toast.info("2FA enrolment is not enabled yet."); }}>
                  Enable 2FA
                </GhostButton>
              </div>
            </div>

            <div style={{ padding: "14px 18px 6px" }}>
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>Active sessions</div>
              <div style={{ fontSize: 11.5, color: A.inkMute, marginBottom: 12 }}>
                Shows the current device. Multi-session listing requires the Supabase admin API and isn't enabled yet — for now, only your current session is visible.
              </div>
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "12px 18px", borderTop: `1px solid ${A.borderRow}` }}>
              <div style={{ width: 34, height: 34, borderRadius: 7, background: A.greenSoft, color: A.green, display: "flex", alignItems: "center", justifyContent: "center" }}>
                <Laptop size={15} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600 }}>This device</div>
                  <Tag tone="green">Current</Tag>
                </div>
                <div style={{ fontSize: 11, color: A.inkMute, marginTop: 2, fontFamily: A.mono }}>
                  {typeof navigator !== "undefined" ? navigator.userAgent.split(") ")[0].split(" (")[0] : "Browser"}
                  {user?.last_sign_in_at && ` · since ${new Date(user.last_sign_in_at).toLocaleString("en-ZA", { dateStyle: "short", timeStyle: "short" })}`}
                </div>
              </div>
            </div>

            <div style={{ padding: "12px 18px", borderTop: `1px solid ${A.borderRow}`, background: A.panelTint, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ fontSize: 11.5, color: A.inkMute }}>Sign out of this device</div>
              <SignOutButton />
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}