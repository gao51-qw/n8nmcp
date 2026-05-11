// Client-only fetch interceptor: forwards the Supabase access token to all
// `/_serverFn/*` calls so server functions guarded by requireSupabaseAuth
// can read `Authorization: Bearer <token>` from the request.
import { supabase } from "@/integrations/supabase/client";

let installed = false;

export function installServerFnAuth() {
  if (installed || typeof window === "undefined") return;
  installed = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    try {
      const url =
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url && url.includes("/_serverFn/")) {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        if (token) {
          const headers = new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined));
          if (!headers.has("Authorization")) {
            headers.set("Authorization", `Bearer ${token}`);
          }
          return originalFetch(input, { ...init, headers });
        }
      }
    } catch {
      // fall through to original fetch
    }
    return originalFetch(input, init);
  };
}
