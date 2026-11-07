// Browser Supabase client for data, storage and realtime.
//
// It never holds a refresh token. Sessions are owned by the same-origin
// /api/auth endpoints (src/app/api/auth/*): the refresh token lives only in
// the HttpOnly `n8nmcp-rt` cookie, and the short-lived access token lives only
// in memory (src/lib/auth/token-store.ts). This client reads that token through
// supabase-js's `accessToken` option, so PostgREST, Storage and Realtime all
// send the current user's JWT and pick up every refresh.
//
// With `accessToken` set, supabase-js disables `supabase.auth.*` (any access
// throws). Sign-in, sign-up, password reset and sign-out go through
// src/lib/auth/auth-api.client.ts; the user comes from `useAuth()`; the OAuth
// consent calls go through src/lib/auth/oauth-server.client.ts.
//
// Server routes never read cookies for API auth: they authenticate with the
// `Authorization: Bearer <access token>` header that `supportFetch` and the
// other client helpers build from the in-memory token.
import { createClient } from "@supabase/supabase-js";
import { authStore, getAccessToken } from "@/lib/auth/browser-session.client";
import type { Database } from "./types";

function supabaseEnv() {
  const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const SUPABASE_PUBLISHABLE_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_PUBLISHABLE_KEY;

  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
    const missing = [
      ...(!SUPABASE_URL ? ["SUPABASE_URL"] : []),
      ...(!SUPABASE_PUBLISHABLE_KEY ? ["SUPABASE_PUBLISHABLE_KEY"] : []),
    ];
    const message = `Missing Supabase environment variable(s): ${missing.join(", ")}. Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.`;
    console.error(`[Supabase] ${message}`);
    throw new Error(message);
  }
  return { url: SUPABASE_URL, key: SUPABASE_PUBLISHABLE_KEY };
}

/** Public Supabase URL and key for the browser (used by the OAuth helpers too). */
export function browserSupabaseConfig(): { url: string; key: string } {
  const { url, key } = supabaseEnv();
  return { url: url.replace(/\/+$/, ""), key };
}

function createSupabaseClient() {
  const { url, key } = supabaseEnv();
  const client = createClient<Database>(url, key, {
    // Returning null (signed out) makes supabase-js fall back to the public key.
    accessToken: () => getAccessToken(),
  });

  if (typeof window !== "undefined") {
    // Realtime re-reads the token on every heartbeat; push changes at once.
    let last = authStore().getSnapshot().session?.access_token ?? null;
    authStore().subscribe(() => {
      const next = authStore().getSnapshot().session?.access_token ?? null;
      if (next === last) return;
      last = next;
      void client.realtime.setAuth().catch(() => undefined);
    });
  }
  return client;
}

let _supabase: ReturnType<typeof createSupabaseClient> | undefined;

// Import the supabase client like this:
// import { supabase } from "@/integrations/supabase/client";
export const supabase = new Proxy({} as ReturnType<typeof createSupabaseClient>, {
  get(_, prop, receiver) {
    if (!_supabase) _supabase = createSupabaseClient();
    return Reflect.get(_supabase, prop, receiver);
  },
});
