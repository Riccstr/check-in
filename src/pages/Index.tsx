import { useAuth } from "@/hooks/useAuth";
import { Navigate } from "react-router-dom";

export default function Index() {
  const { role, loading } = useAuth();

  if (loading) return null;

  if (role === "admin") return <Navigate to="/admin/visits" replace />;
  return <Navigate to="/log-visit" replace />;
}
