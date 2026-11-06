// Authenticated fetch for the Agent Console.
//
// The Supabase access token expires after about an hour, so it is read from
// the auth client on every request instead of being kept in component state
// (`getSession()` refreshes an expired token on its own). If the API still
// answers 401, the session is refreshed once and the request is retried; a
// second 401 means the session is really gone.
import { supabase } from "@/integrations/supabase/client";

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again to continue.";

export class SessionExpiredError extends Error {
  readonly status = 401;

  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = "SessionExpiredError";
  }
}

async function currentAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new SessionExpiredError();
  return token;
}

async function refreshedAccessToken(): Promise<string | null> {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    return error ? null : (data.session?.access_token ?? null);
  } catch {
    return null;
  }
}

function withToken(init: RequestInit, token: string): RequestInit {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${token}`);
  return { ...init, headers };
}

/**
 * Sends `init` with a fresh bearer token. Resolves with the response for every
 * status except an unrecoverable 401, which rejects with SessionExpiredError.
 */
export async function sessionFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const token = await currentAccessToken();
  const response = await fetch(url, withToken(init, token));
  if (response.status !== 401) return response;

  if (init.signal?.aborted) return response;
  const refreshed = await refreshedAccessToken();
  if (!refreshed) throw new SessionExpiredError();

  const retried = await fetch(url, withToken(init, refreshed));
  if (retried.status === 401) throw new SessionExpiredError();
  return retried;
}
