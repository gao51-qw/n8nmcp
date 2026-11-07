// Browser calls to the same-origin auth endpoints (src/app/api/auth/*). Every
// call is a JSON POST; the HttpOnly refresh cookie travels with it
// automatically and is never visible here.
import type { User } from "@supabase/supabase-js";
import { z } from "zod";
import { AUTH_API } from "./constants";
import type { AuthSession, RefreshOutcome } from "./token-store";

/** A failed auth request; `message` is safe to show to the user. */
export class AuthRequestError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status: number, code = "request_failed") {
    super(message);
    this.name = "AuthRequestError";
    this.status = status;
    this.code = code;
  }
}

const sessionSchema = z.object({
  access_token: z.string().min(1).max(8192),
  expires_at: z.number().int().positive(),
  user: z.object({ id: z.string().min(1) }).passthrough(),
});

const signupSchema = z.union([
  sessionSchema.extend({ confirmation_required: z.literal(false).optional() }),
  z.object({ confirmation_required: z.literal(true) }),
]);

const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";

function toSession(value: z.infer<typeof sessionSchema>): AuthSession {
  return {
    access_token: value.access_token,
    expires_at: value.expires_at,
    user: value.user as unknown as User,
  };
}

async function errorFrom(response: Response): Promise<AuthRequestError> {
  const fallback = `Request failed (${response.status})`;
  const body: unknown = await response.json().catch(() => null);
  const error = body && typeof body === "object" ? (body as { error?: unknown }).error : undefined;
  if (error && typeof error === "object") {
    const { message, code } = error as { message?: unknown; code?: unknown };
    return new AuthRequestError(
      typeof message === "string" && message.trim() ? message.trim().slice(0, 300) : fallback,
      response.status,
      typeof code === "string" ? code : undefined,
    );
  }
  return new AuthRequestError(fallback, response.status);
}

async function post(
  path: string,
  body: Record<string, unknown> = {},
  accessToken?: string,
): Promise<Response> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  try {
    return await fetch(path, {
      method: "POST",
      credentials: "same-origin",
      cache: "no-store",
      headers,
      body: JSON.stringify(body),
    });
  } catch {
    throw new AuthRequestError(NETWORK_ERROR, 0, "network_error");
  }
}

async function sessionFrom(response: Response): Promise<AuthSession> {
  if (!response.ok) throw await errorFrom(response);
  const parsed = sessionSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AuthRequestError("Unexpected server response", 502);
  return toSession(parsed.data);
}

export async function loginRequest(email: string, password: string): Promise<AuthSession> {
  return sessionFrom(await post(AUTH_API.login, { email, password }));
}

export type SignupResult =
  { confirmationRequired: true } | { confirmationRequired: false; session: AuthSession };

export async function signupRequest(
  email: string,
  password: string,
  next: string,
): Promise<SignupResult> {
  const response = await post(AUTH_API.signup, { email, password, next });
  if (!response.ok) throw await errorFrom(response);
  const parsed = signupSchema.safeParse(await response.json().catch(() => null));
  if (!parsed.success) throw new AuthRequestError("Unexpected server response", 502);
  if (parsed.data.confirmation_required === true) return { confirmationRequired: true };
  return {
    confirmationRequired: false,
    session: toSession(parsed.data as z.infer<typeof sessionSchema>),
  };
}

export async function recoverRequest(email: string, next: string): Promise<void> {
  const response = await post(AUTH_API.recover, { email, next });
  if (!response.ok) throw await errorFrom(response);
}

/** Never throws: a refresh either yields a session, a definite sign-out, or an error. */
export async function refreshRequest(): Promise<RefreshOutcome> {
  let response: Response;
  try {
    response = await post(AUTH_API.refresh);
  } catch {
    return { kind: "error" };
  }
  // 204: no refresh cookie at all (a signed-out visitor); 401: it was rejected.
  if (response.status === 204 || response.status === 401) return { kind: "signed_out" };
  if (!response.ok) return { kind: "error" };
  const parsed = sessionSchema.safeParse(await response.json().catch(() => null));
  return parsed.success ? { kind: "session", session: toSession(parsed.data) } : { kind: "error" };
}

export async function exchangeRequest(tokens: {
  refresh_token: string;
  access_token?: string;
}): Promise<AuthSession> {
  return sessionFrom(await post(AUTH_API.exchange, tokens));
}

export async function logoutRequest(accessToken: string | null): Promise<void> {
  const response = await post(AUTH_API.logout, {}, accessToken ?? undefined);
  if (!response.ok) throw await errorFrom(response);
}

export async function updatePasswordRequest(accessToken: string, password: string): Promise<void> {
  const response = await post(AUTH_API.password, { password }, accessToken);
  if (!response.ok) throw await errorFrom(response);
}
