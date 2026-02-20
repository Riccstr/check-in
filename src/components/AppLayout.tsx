import { useAuth } from "@/hooks/useAuth";
import { Navigate, Outlet, Link, useLocation } from "react-router-dom";
import { ClipboardCheck, LogOut, MapPin, BarChart3, Users, UserCog, Link2, Eye, Download, Menu, X, CalendarDays, Settings, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import OfflineStatusBar from "@/components/OfflineStatusBar";
import { setupAutoSync } from "@/lib/syncEngine";

export default function AppLayout() {
  const { user, role, loading, signOut } = useAuth();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  // Setup auto-sync for offline visits
  useEffect(() => {
    const cleanup = setupAutoSync();
    return cleanup;
  }, []);

  if (loading) return <div className="flex min-h-screen items-center justify-center"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!role) return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="text-center space-y-2">
        <h2 className="text-xl font-semibold">No Role Assigned</h2>
        <p className="text-muted-foreground">An admin needs to assign you a role.</p>
        <Button variant="outline" onClick={signOut}>Sign Out</Button>
      </div>
    </div>
  );

  const repLinks = [
    { to: "/schedule", label: "Schedule", icon: CalendarDays },
    { to: "/my-visits", label: "My Visits", icon: Eye },
    { to: "/averages", label: "Averages", icon: BarChart3 },
  ];

  const adminLinks = [
    { to: "/admin/customers", label: "Customers", icon: Users },
    { to: "/admin/reps", label: "Reps", icon: UserCog },
    { to: "/admin/assignments", label: "Assignments", icon: Link2 },
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
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
              <ClipboardCheck className="h-4 w-4 text-primary-foreground" />
            </div>
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
              {role}
            </span>
            <Button variant="ghost" size="icon" onClick={signOut} title="Sign out">
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
              <Link key={l.to} to={l.to} onClick={() => setMenuOpen(false)} className={cn("nav-link block", isActive(l.to) ? "nav-link-active" : "nav-link-inactive")}>
                <l.icon className="inline-block h-4 w-4 mr-2" />
                {l.label}
              </Link>
            ))}
          </nav>
        )}
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
