import { useAuth } from "@/hooks/useAuth";
import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import {
  LogOut,
  Users,
  UserCog,
  Eye,
  Download,
  Menu,
  X,
  CalendarDays,
  Settings,
  ShieldCheck,
  WifiOff,
  RefreshCw,
} from "lucide-react";
import logoImg from "@/assets/logo.png";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import OfflineStatusBar from "@/components/OfflineStatusBar";
import { setupAutoSync } from "@/lib/syncEngine";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { toast } from "sonner";

export default function AppLayout() {
  const { user, role, repName, loading, signOut, roleState, refreshAuthContext } = useAuth();
  const isOnline = useOnlineStatus();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Setup auto-sync for offline visits (rep only)
  useEffect(() => {
    if (role !== "rep") return;
    const cleanup = setupAutoSync();
    return cleanup;
  }, [role]);

  useEffect(() => {
    if (roleState !== "offline_bootstrap_required" || !user) return;
    const noticeKey = `offline-bootstrap-notice-${user.id}`;
    if (sessionStorage.getItem(noticeKey)) return;

    toast.info("Sign in once with internet to enable offline mode on this device.");
    sessionStorage.setItem(noticeKey, "1");
  }, [roleState, user]);

  if (loading)
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );

  if (!user) return <Navigate to="/auth" replace />;

  if (roleState === "offline_bootstrap_required") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center space-y-3 max-w-md">
          <WifiOff className="h-10 w-10 mx-auto text-muted-foreground" />
          <h2 className="text-xl font-semibold">Offline setup required once</h2>
          <p className="text-muted-foreground">
            This device needs one successful online sign-in to cache your secure workspace for offline use.
          </p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={refreshAuthContext} disabled={!isOnline}>
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
            <Button variant="ghost" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!role && roleState === "unassigned" && isOnline) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">No Role Assigned</h2>
          <p className="text-muted-foreground">An admin needs to assign you a role.</p>
          <Button variant="outline" onClick={signOut}>
            Sign Out
          </Button>
        </div>
      </div>
    );
  }

  if (!role) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="text-center space-y-3 max-w-md">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-muted-foreground">Restoring your workspace…</p>
          <div className="flex items-center justify-center gap-2">
            <Button variant="outline" onClick={refreshAuthContext}>
              <RefreshCw className="h-4 w-4 mr-1" /> Retry
            </Button>
            <Button variant="ghost" onClick={signOut}>
              Sign Out
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const repLinks = [
    { to: "/schedule", label: "Schedule", icon: CalendarDays },
    { to: "/my-visits", label: "My Visits", icon: Eye },
  ];

  const adminLinks = [
    { to: "/admin/customers", label: "Customers", icon: Users },
    { to: "/admin/reps", label: "Reps", icon: UserCog },
    { to: "/admin/schedules", label: "Schedules", icon: CalendarDays },
    { to: "/admin/visits", label: "Visits", icon: Eye },
    { to: "/admin/reports", label: "Reports", icon: Download },
    { to: "/admin/users", label: "Users", icon: ShieldCheck },
    { to: "/admin/account", label: "Account", icon: Settings },
  ];

  const links = role === "admin" ? adminLinks : repLinks;

  const isActive = (path: string) => location.pathname === path;

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-card">
        <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4">
          <Link to="/" className="flex items-center gap-2 font-bold text-foreground">
            <img src={logoImg} alt="Check-In Tracker" className="h-8 w-8" />
            <span className="hidden sm:inline">Check-In Tracker</span>
          </Link>

          {/* Desktop nav */}
          <nav className="hidden md:flex items-center gap-1">
            {links.map((l) => (
              <Link key={l.to} to={l.to} className={cn("nav-link", isActive(l.to) ? "nav-link-active" : "nav-link-inactive")}>
                <l.icon className="inline-block h-4 w-4 mr-1" />
                {l.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <OfflineStatusBar />
            <span className="hidden sm:inline text-xs font-medium uppercase tracking-wide px-2 py-1 rounded-full bg-secondary text-secondary-foreground">
              {role === "rep" && repName ? repName : role}
            </span>
            {/* Logout button visible on desktop, or on mobile for admins (who have no hamburger on desktop) */}
            <Button variant="ghost" size="icon" onClick={signOut} title="Sign out" className={role === "rep" ? "hidden md:inline-flex" : ""}>
              <LogOut className="h-4 w-4" />
            </Button>
            <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setMenuOpen(!menuOpen)}>
              {menuOpen ? <X className="h-4 w-4" /> : <Menu className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        {/* Mobile nav */}
        {menuOpen && (
          <nav className="md:hidden border-t px-4 py-2 space-y-1 bg-card">
            {links.map((l) => (
              <Link
                key={l.to}
                to={l.to}
                onClick={() => setMenuOpen(false)}
                className={cn("nav-link block", isActive(l.to) ? "nav-link-active" : "nav-link-inactive")}
              >
                <l.icon className="inline-block h-4 w-4 mr-2" />
                {l.label}
              </Link>
            ))}
            {role === "rep" && (
              <button
                type="button"
                onClick={() => { setMenuOpen(false); signOut(); }}
                className="nav-link block w-full text-left text-red-500 mt-1 pt-2 border-t border-border"
              >
                <LogOut className="inline-block h-4 w-4 mr-2" />
                Logout
              </button>
            )}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
