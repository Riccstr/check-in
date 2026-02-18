import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import AppLayout from "@/components/AppLayout";
import Auth from "@/pages/Auth";
import Index from "@/pages/Index";
import LogVisit from "@/pages/LogVisit";
import DailySchedule from "@/pages/DailySchedule";
import MyVisits from "@/pages/MyVisits";
import Averages from "@/pages/Averages";
import AdminCustomers from "@/pages/admin/AdminCustomers";
import AdminReps from "@/pages/admin/AdminReps";
import AdminAssignments from "@/pages/admin/AdminAssignments";
import AdminSchedules from "@/pages/admin/AdminSchedules";
import AdminVisits from "@/pages/admin/AdminVisits";
import AdminExports from "@/pages/admin/AdminExports";
import AdminAccount from "@/pages/admin/AdminAccount";
import AdminUsers from "@/pages/admin/AdminUsers";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/auth" element={<Auth />} />
            <Route element={<AppLayout />}>
              <Route path="/" element={<Index />} />
              <Route path="/log-visit" element={<LogVisit />} />
              <Route path="/schedule" element={<DailySchedule />} />
              <Route path="/my-visits" element={<MyVisits />} />
              <Route path="/averages" element={<Averages />} />
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
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
