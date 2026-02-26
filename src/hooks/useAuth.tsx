import { createContext, useContext, useEffect, useState, useRef, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { User, Session } from "@supabase/supabase-js";
import { getCachedUserAuth, setCachedUserAuth } from "@/lib/offlineDb";

type AppRole = "admin" | "rep";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  repId: string | null;
  repName: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [repId, setRepId] = useState<string | null>(null);
  const [repName, setRepName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const roleFetchedRef = useRef(false);

  const fetchRoleAndRep = async (userId: string): Promise<boolean> => {
    try {
      const [rolesRes, repRes] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", userId),
        supabase.from("reps").select("id, rep_name").eq("user_id", userId).maybeSingle(),
      ]);

      const fetchedRole = rolesRes.data && rolesRes.data.length > 0 ? rolesRes.data[0].role : null;
      const fetchedRepId = repRes.data?.id ?? null;
      const fetchedRepName = repRes.data?.rep_name ?? null;

      setRole(fetchedRole);
      setRepId(fetchedRepId);
      setRepName(fetchedRepName);
      roleFetchedRef.current = true;

      // Cache to IndexedDB for offline use — fire and forget so it never blocks loading
      setCachedUserAuth({
        user_id: userId,
        role: fetchedRole,
        rep_id: fetchedRepId,
        rep_name: fetchedRepName,
        cached_at: new Date().toISOString(),
      }).catch((e) => console.warn("[Auth] Failed to cache auth:", e));

      return true;
    } catch (err) {
      console.warn("[Auth] Failed to fetch role from server, trying cache:", err);
      return false;
    }
  };

  const loadCachedRole = async (userId: string): Promise<boolean> => {
    try {
      const cached = await getCachedUserAuth(userId);
      if (cached) {
        setRole(cached.role);
        setRepId(cached.rep_id);
        setRepName(cached.rep_name);
        roleFetchedRef.current = true;
        return true;
      }
    } catch (err) {
      console.warn("[Auth] Failed to load cached role:", err);
    }
    return false;
  };

  useEffect(() => {
    let loadingResolved = false;
    const resolveLoading = () => {
      if (!loadingResolved) {
        loadingResolved = true;
        setLoading(false);
      }
    };

    // Safety timeout — never stay stuck on loading spinner
    const safetyTimer = setTimeout(() => {
      if (!loadingResolved) {
        console.warn("[Auth] Safety timeout: forcing loading=false");
        resolveLoading();
      }
    }, 5000);

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (_event, session) => {
        setSession(session);
        setUser(session?.user ?? null);
        if (session?.user) {
          const userId = session.user.id;
          const serverOk = await fetchRoleAndRep(userId);
          if (!serverOk) {
            await loadCachedRole(userId);
          }
        } else {
          setRole(null);
          setRepId(null);
          setRepName(null);
          roleFetchedRef.current = false;
        }
        resolveLoading();
      }
    );

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        const userId = session.user.id;
        const serverOk = await fetchRoleAndRep(userId);
        if (!serverOk) {
          await loadCachedRole(userId);
        }
      }
      resolveLoading();
    });

    return () => {
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
    <AuthContext.Provider value={{ user, session, role, repId, repName, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
