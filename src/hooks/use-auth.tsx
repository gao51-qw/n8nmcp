"use client";

import { createContext, useContext, useEffect, useSyncExternalStore, type ReactNode } from "react";
import type { User } from "@supabase/supabase-js";
import { authStore, signOut as endSession } from "@/lib/auth/browser-session.client";
import type { AuthSession, AuthSnapshot } from "@/lib/auth/token-store";

export type { AuthSession } from "@/lib/auth/token-store";

type AuthState = {
  /** The in-memory session (access token, expiry, user). Never holds a refresh token. */
  session: AuthSession | null;
  user: User | null;
  loading: boolean;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

const SERVER_SNAPSHOT: AuthSnapshot = { session: null, loading: true, persisted: false };

const subscribe = (listener: () => void) => authStore().subscribe(listener);
const getSnapshot = () => authStore().getSnapshot();
const getServerSnapshot = () => SERVER_SNAPSHOT;

export function AuthProvider({ children }: { children: ReactNode }) {
  const { session, loading } = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  useEffect(() => {
    // Exchanges an email-link fragment or a legacy session if present, then
    // restores the session from the HttpOnly refresh cookie.
    void authStore().start();
  }, []);

  return (
    <AuthContext.Provider
      value={{ session, user: session?.user ?? null, loading, signOut: endSession }}
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
