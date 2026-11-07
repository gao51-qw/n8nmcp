// Server-side Supabase Auth calls for the /api/auth endpoints. They run with
// the public (anon/publishable) key, exactly as the browser used to, and never
// with the service-role key: Supabase Auth applies its normal user-facing
// rules (password policy, email confirmation, refresh-token rotation).
import { createClient, type AuthError, type Session } from "@supabase/supabase-js";
import { HttpError } from "@/lib/http/api-response.server";

function supabaseAuthEnv(): { url: string; key: string } {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new HttpError(503, "service_unavailable", "Sign-in is not configured");
  }
  return { url: url.replace(/\/+$/, ""), key };
}

/** Upper bound for one Supabase Auth request made on behalf of a browser. */
export const AUTH_UPSTREAM_TIMEOUT_MS = 8_000;

function timedFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, {
    ...init,
    signal: init?.signal ?? AbortSignal.timeout(AUTH_UPSTREAM_TIMEOUT_MS),
  });
}

/** A stateless Supabase Auth client (no storage, no timers) for one request. */
export function anonAuthClient() {
  const { url, key } = supabaseAuthEnv();
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: timedFetch },
  }).auth;
}

type AuthClient = ReturnType<typeof anonAuthClient>;
type RefreshResult = Awaited<ReturnType<AuthClient["refreshSession"]>>;

/**
 * `refreshSession` with a deadline. supabase-js retries a refresh that fails
 * with a network error for up to ~30 s, which would hold the browser's page
 * load; past the deadline this answers with a retryable (5xx) error instead,
 * which the routes map to 502 and never to a sign-out.
 */
export async function refreshWithDeadline(
  auth: Pick<AuthClient, "refreshSession">,
  refreshToken: string,
  timeoutMs = AUTH_UPSTREAM_TIMEOUT_MS + 2_000,
): Promise<RefreshResult> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<RefreshResult>((resolve) => {
    timer = setTimeout(
      () =>
        resolve({
          data: { session: null, user: null },
          error: {
            name: "AuthRetryableFetchError",
            status: 504,
            code: "upstream_timeout",
            message: "Supabase Auth did not answer in time",
          } as AuthError,
        }),
      timeoutMs,
    );
  });
  try {
    return await Promise.race([auth.refreshSession({ refresh_token: refreshToken }), deadline]);
  } finally {
    clearTimeout(timer);
  }
}

export type SessionBody = {
  access_token: string;
  expires_at: number;
  user: Session["user"];
};

/** The JSON a session endpoint returns. The refresh token is never in a body. */
export function sessionBody(session: Session, nowSeconds = Math.floor(Date.now() / 1000)) {
  return {
    access_token: session.access_token,
    expires_at: session.expires_at ?? nowSeconds + session.expires_in,
    user: session.user,
  } satisfies SessionBody;
}

const UNAVAILABLE = "The sign-in service is unavailable. Try again shortly.";

/**
 * Maps a Supabase Auth failure to a user-facing HttpError. 4xx messages from
 * Supabase ("Invalid login credentials", "Email not confirmed", password
 * policy) are meant for users and pass through; anything else is generic.
 */
export function authFailure(error: AuthError | null | undefined, fallback: string): HttpError {
  const status = typeof error?.status === "number" ? error.status : 0;
  const code = typeof error?.code === "string" ? error.code : "";
  if (status === 429 || code.startsWith("over_")) {
    return new HttpError(
      429,
      "rate_limited",
      "Too many attempts. Wait a few minutes and try again.",
    );
  }
  if (status >= 400 && status < 500) {
    const message = error?.message?.trim().slice(0, 300) || fallback;
    return new HttpError(
      status === 401 || status === 403 ? 401 : 400,
      code || "auth_rejected",
      message,
    );
  }
  return new HttpError(502, "upstream_error", UNAVAILABLE);
}

/**
 * Changes the password of the user the access token belongs to through
 * Supabase Auth's own `PUT /user` endpoint, so its password policy and
 * reauthentication rules apply.
 */
export async function updatePasswordWithToken(
  accessToken: string,
  password: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const { url, key } = supabaseAuthEnv();
  let response: Response;
  try {
    response = await fetchImpl(`${url}/auth/v1/user`, {
      signal: AbortSignal.timeout(AUTH_UPSTREAM_TIMEOUT_MS),
      method: "PUT",
      headers: {
        apikey: key,
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ password }),
      cache: "no-store",
    });
  } catch {
    throw new HttpError(502, "upstream_error", UNAVAILABLE);
  }
  if (response.ok) return;
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const message =
    (typeof body?.msg === "string" && body.msg) ||
    (typeof body?.message === "string" && body.message) ||
    (typeof body?.error_description === "string" && body.error_description) ||
    "";
  const code = typeof body?.error_code === "string" ? body.error_code : "";
  throw authFailure(
    { status: response.status, code, message, name: "AuthApiError" } as AuthError,
    "Could not update the password.",
  );
}
