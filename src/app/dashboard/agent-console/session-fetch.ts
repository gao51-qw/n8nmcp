// Authenticated fetch for the Agent Console.
//
// The Supabase access token expires after about an hour, so it is read from
// the in-memory token store on every request instead of being kept in
// component state (the store refreshes it through the HttpOnly cookie before
// it expires). If the API still answers 401, the session is refreshed once and
// the request is retried; a second 401 means the session is really gone.
import { authStore, getAccessToken } from "@/lib/auth/browser-session.client";

export const SESSION_EXPIRED_MESSAGE = "Your session has expired. Sign in again to continue.";

export class SessionExpiredError extends Error {
  readonly status = 401;

  constructor() {
    super(SESSION_EXPIRED_MESSAGE);
    this.name = "SessionExpiredError";
  }
}

async function currentAccessToken(): Promise<string> {
  const token = await getAccessToken().catch(() => null);
  if (!token) throw new SessionExpiredError();
  return token;
}

async function refreshedAccessToken(): Promise<string | null> {
  try {
    return (await authStore().refresh())?.access_token ?? null;
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
