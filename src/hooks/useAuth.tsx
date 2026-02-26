import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { getCachedUserAuth, setCachedUserAuth, type CachedUserAuth } from "@/lib/offlineDb";
import { refreshOfflineBootstrap } from "@/lib/offlineBootstrap";

type AppRole = "admin" | "rep";
type RoleState = "loading" | "ready" | "unassigned" | "offline_bootstrap_required" | "resolving";

interface ResolvedAuthContext {
  role: AppRole | null;
  repId: string | null;
  repName: string | null;
  profile: CachedUserAuth["profile"];
  permissions: string[];
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  repId: string | null;
  repName: string | null;
  profile: CachedUserAuth["profile"];
  permissions: string[];
  roleState: RoleState;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  refreshAuthContext: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function buildPermissions(role: AppRole | null): string[] {
  if (role === "admin") return ["admin:all"];
  if (role === "rep") return ["rep:schedule", "rep:visits"];
  return [];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [repId, setRepId] = useState<string | null>(null);
  const [repName, setRepName] = useState<string | null>(null);
  const [profile, setProfile] = useState<CachedUserAuth["profile"]>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [roleState, setRoleState] = useState<RoleState>("loading");
  const [loading, setLoading] = useState(true);
  const activeSessionRunRef = useRef(0);

  const applyResolvedContext = (
    userId: string,
    context: ResolvedAuthContext,
    source: "cache" | "server"
  ) => {
    setRole(context.role);
    setRepId(context.repId);
    setRepName(context.repName);
    setProfile(context.profile || null);
    setPermissions(context.permissions);

    if (context.role) {
      setRoleState("ready");
    } else if (source === "server") {
      setRoleState("unassigned");
    }

    setCachedUserAuth({
      user_id: userId,
      role: context.role,
      rep_id: context.repId,
      rep_name: context.repName,
      profile: context.profile || null,
      permissions: context.permissions,
      cached_at: new Date().toISOString(),
    }).catch((e) => console.warn("[Auth] Failed to cache auth:", e));
  };

  const fetchServerContext = async (userId: string): Promise<ResolvedAuthContext | null> => {
    try {
      const [rolesRes, repRes, profileRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("reps").select("id, rep_name").eq("user_id", userId).maybeSingle(),
        supabase
          .from("profiles")
          .select("id, full_name, created_at, login_updated_at, login_updated_by")
          .eq("id", userId)
          .maybeSingle(),
      ]);

      const fetchedRole = rolesRes.data && rolesRes.data.length > 0 ? (rolesRes.data[0].role as AppRole) : null;
      const fetchedRepId = repRes.data?.id ?? null;
      const fetchedRepName = repRes.data?.rep_name ?? null;
      const fetchedProfile = profileRes.data
        ? {
            id: profileRes.data.id,
            full_name: profileRes.data.full_name,
            created_at: profileRes.data.created_at,
            login_updated_at: profileRes.data.login_updated_at,
            login_updated_by: profileRes.data.login_updated_by,
          }
        : null;

      return {
        role: fetchedRole,
        repId: fetchedRepId,
        repName: fetchedRepName,
        profile: fetchedProfile,
        permissions: buildPermissions(fetchedRole),
      };
    } catch (err) {
      console.warn("[Auth] Failed to fetch role/profile from server:", err);
      return null;
    }
  };

  const loadCachedContext = async (userId: string): Promise<ResolvedAuthContext | null> => {
    try {
      const cached = await getCachedUserAuth(userId);
      if (!cached) return null;

      return {
        role: cached.role,
        repId: cached.rep_id,
        repName: cached.rep_name,
        profile: cached.profile,
        permissions: cached.permissions,
      };
    } catch (err) {
      console.warn("[Auth] Failed to load cached role/profile:", err);
      return null;
    }
  };

  const refreshAuthContext = async () => {
    if (!user) return;
    const context = await fetchServerContext(user.id);
    if (!context) return;

    applyResolvedContext(user.id, context, "server");
    await refreshOfflineBootstrap(user.id, context.role, context.repId);
  };

  useEffect(() => {
    let loadingResolved = false;
    let listenerDeliveredInitial = false;
    let disposed = false;

    const resolveLoading = () => {
      if (!loadingResolved) {
        loadingResolved = true;
        setLoading(false);
      }
    };

    const clearResolvedContext = () => {
      setRole(null);
      setRepId(null);
      setRepName(null);
      setProfile(null);
      setPermissions([]);
      setRoleState("loading");
    };

    const processSession = async (nextSession: Session | null) => {
      const runId = ++activeSessionRunRef.current;

      setSession(nextSession);
      setUser(nextSession?.user ?? null);

      if (!nextSession?.user) {
        clearResolvedContext();
        if (!disposed) resolveLoading();
        return;
      }

      const userId = nextSession.user.id;
      const cached = await loadCachedContext(userId);
      if (disposed || runId !== activeSessionRunRef.current) return;

      const hasCachedRole = Boolean(cached?.role);

      if (hasCachedRole && cached) {
        applyResolvedContext(userId, cached, "cache");
        resolveLoading();
      } else {
        setRoleState("loading");
      }

      if (!navigator.onLine && !hasCachedRole) {
        setRoleState("offline_bootstrap_required");
        resolveLoading();
        return;
      }

      const serverContext = await fetchServerContext(userId);
      if (disposed || runId !== activeSessionRunRef.current) return;

      if (serverContext) {
        applyResolvedContext(userId, serverContext, "server");
        resolveLoading();

        if (serverContext.role) {
          refreshOfflineBootstrap(userId, serverContext.role, serverContext.repId).catch((e) =>
            console.warn("[Auth] Failed to refresh offline bootstrap:", e)
          );
        }
      } else if (!hasCachedRole) {
        if (!navigator.onLine) {
          setRoleState("offline_bootstrap_required");
        } else {
          setRoleState("resolving");
        }
        resolveLoading();
      }
    };

    // Safety timeout — never stay stuck on loading spinner
    const safetyTimer = setTimeout(() => {
      if (!loadingResolved) {
        console.warn("[Auth] Safety timeout: forcing loading=false");
        resolveLoading();
      }
    }, 8000);

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      console.log("[Auth] onAuthStateChange:", _event);
      setTimeout(() => {
        listenerDeliveredInitial = true;
        void processSession(nextSession);
      }, 0);
    });

    supabase.auth
      .getSession()
      .then(({ data: { session: currentSession } }) => {
        if (listenerDeliveredInitial) return;
        listenerDeliveredInitial = true;
        setTimeout(() => void processSession(currentSession), 0);
      })
      .catch((err) => {
        console.warn("[Auth] getSession failed:", err);
        resolveLoading();
      });

    return () => {
      disposed = true;
      clearTimeout(safetyTimer);
      subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, fullName: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        role,
        repId,
        repName,
        profile,
        permissions,
        roleState,
        loading,
        signIn,
        signUp,
        signOut,
        refreshAuthContext,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
