import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { clearAuthSessionCookies, supabase } from "@/integrations/supabase/client";

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Set up the listener before reading the initial session to avoid missing auth changes.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      setLoading(false);
    });

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    // A global sign-out revokes the refresh token server-side. If that call
    // fails (offline, already revoked) fall back to a local sign-out, then
    // clear the shared parent-domain cookies explicitly either way so no
    // subdomain keeps the session.
    try {
      const { error } = await supabase.auth.signOut();
      if (error) await supabase.auth.signOut({ scope: "local" });
    } catch {
      await supabase.auth.signOut({ scope: "local" }).catch(() => undefined);
    } finally {
      clearAuthSessionCookies();
      setSession(null);
    }
  };

  return (
    <AuthContext.Provider value={{ session, user: session?.user ?? null, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
