import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useLocation, useNavigate } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import Index from "@/pages/Index";
import LogVisit from "@/pages/LogVisit";
import DailySchedule from "@/pages/DailySchedule";
import MyVisits from "@/pages/MyVisits";
import AdminCustomers from "@/pages/admin/AdminCustomers";
import AdminReps from "@/pages/admin/AdminReps";
import AdminAssignments from "@/pages/admin/AdminAssignments";
import AdminSchedules from "@/pages/admin/AdminSchedules";
import AdminVisits from "@/pages/admin/AdminVisits";
import AdminExports from "@/pages/admin/AdminExports";
import AdminAccount from "@/pages/admin/AdminAccount";
import AdminUsers from "@/pages/admin/AdminUsers";
import NotFound from "@/pages/NotFound";
import { toast } from "sonner";

const queryClient = new QueryClient();

const ROUTE_STORAGE_KEY = "checkin-tracker-last-route";

function GlobalErrorBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      const msg = String(event.reason?.message || event.reason || "");
      const lower = msg.toLowerCase();
      if (lower.includes("load failed") || lower.includes("failed to fetch") || lower.includes("networkerror")) {
        console.warn("[Global] Suppressed offline rejection:", msg);
        event.preventDefault();
        return;
      }
      console.error("[Global] Unhandled rejection:", msg);
      toast.error("An unexpected error occurred.");
      event.preventDefault();
    };

    window.addEventListener("unhandledrejection", handleRejection);
    return () => window.removeEventListener("unhandledrejection", handleRejection);
  }, []);

  return <>{children}</>;
}

/** Persists the current route to localStorage so the app resumes after minimize/restore */
function RoutePersistence() {
  const location = useLocation();

  useEffect(() => {
    // Don't persist the auth page
    if (location.pathname !== "/auth") {
      const fullPath = `${location.pathname}${location.search}${location.hash}`;
      localStorage.setItem(ROUTE_STORAGE_KEY, fullPath);
    }
  }, [location.pathname, location.search, location.hash]);

  return null;
}

/** On initial load, restore to the last visited route if we're on "/" and have a saved route */
function RouteRestorer() {
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    const savedRoute = localStorage.getItem(ROUTE_STORAGE_KEY);
    if (savedRoute && savedRoute.startsWith("/") && savedRoute !== "/" && location.pathname === "/") {
      navigate(savedRoute, { replace: true });
    }
  }, []); // Only run once on mount

  return null;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <GlobalErrorBoundary>
        <Toaster />
        <Sonner />
        <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <RoutePersistence />
          <RouteRestorer />
          <AuthProvider>
            <Routes>
              <Route path="/auth" element={<Auth />} />
              <Route element={<AppLayout />}>
                <Route path="/" element={<Index />} />
                <Route path="/log-visit" element={<LogVisit />} />
                <Route path="/schedule" element={<DailySchedule />} />
                <Route path="/my-visits" element={<MyVisits />} />

                <Route path="/admin/customers" element={<AdminCustomers />} />
                <Route path="/admin/reps" element={<AdminReps />} />
                <Route path="/admin/assignments" element={<AdminAssignments />} />
                <Route path="/admin/schedules" element={<AdminSchedules />} />
                <Route path="/admin/visits" element={<AdminVisits />} />
                <Route path="/admin/reports" element={<AdminExports />} />
                <Route path="/admin/account" element={<AdminAccount />} />
                <Route path="/admin/users" element={<AdminUsers />} />
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </AuthProvider>
        </BrowserRouter>
      </GlobalErrorBoundary>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
