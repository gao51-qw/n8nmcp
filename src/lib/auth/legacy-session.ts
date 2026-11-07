// One-time migration of sessions written by earlier builds, which kept the
// whole Supabase session (refresh token included) where JavaScript can read
// it: a chunked parent-domain cookie `sb-<ref>-auth-token[.n]` and, before
// that, localStorage under the same key. The browser hands the refresh token
// to /api/auth/exchange once and then deletes every copy.

/** The storage key supabase-js derives by default (`sb-<project ref>-auth-token`). */
export function supabaseStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

/** The legacy key for a Supabase URL, or null when the URL is missing or unusable. */
export function legacySessionKey(supabaseUrl: string | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    return supabaseStorageKey(supabaseUrl);
  } catch {
    return null;
  }
}

/** Any project's legacy session cookie or chunk (and the PKCE verifier). */
const LEGACY_COOKIE = /^sb-[A-Za-z0-9-]+-auth-token(?:-code-verifier)?(?:\.\d+)?$/;
/** Any project's legacy localStorage session key. */
const LEGACY_STORAGE_KEY = /^sb-[A-Za-z0-9-]+-auth-token(?:-code-verifier)?$/;
/** supabase-js v1 kept the session under this key. */
const V1_STORAGE_KEY = "supabase.auth.token";

const ENCODED_PREFIX = "base64-";
const REFRESH_TOKEN = /^[\x21-\x7e]{1,2048}$/;

export type CookieJar = {
  read(): string;
  write(cookie: string): void;
};

export type LegacyStorage = Pick<Storage, "getItem" | "removeItem"> &
  Partial<Pick<Storage, "key" | "length">>;

/** Name/value pairs in a `Cookie` header or `document.cookie` string. */
export function parseCookieHeader(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (name && !cookies.has(name)) cookies.set(name, part.slice(index + 1).trim());
  }
  return cookies;
}

/** True for any legacy JavaScript-readable session cookie name. */
export function isLegacySessionCookie(name: string): boolean {
  return LEGACY_COOKIE.test(name);
}

function decodeBase64Value(value: string): string | null {
  try {
    const base64 = value.slice(ENCODED_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function decodeCookieValue(value: string): string | null {
  if (value.startsWith(ENCODED_PREFIX)) return decodeBase64Value(value);
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The refresh token in a serialized supabase-js session (v2 or v1 shape), or null. */
export function refreshTokenFromSessionJson(serialized: string | null): string | null {
  if (!serialized) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(serialized);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const record = parsed as Record<string, unknown>;
  const nested = record.currentSession;
  const token =
    record.refresh_token ??
    (nested && typeof nested === "object"
      ? (nested as Record<string, unknown>).refresh_token
      : undefined);
  return typeof token === "string" && REFRESH_TOKEN.test(token) ? token : null;
}

/** The legacy cookie session for `key` (whole or chunked), decoded, or null. */
function legacyCookieSession(cookies: Map<string, string>, key: string): string | null {
  const whole = cookies.get(key);
  if (whole !== undefined) return decodeCookieValue(whole);
  let joined = "";
  for (let i = 0; cookies.has(`${key}.${i}`); i++) joined += cookies.get(`${key}.${i}`);
  return joined ? decodeCookieValue(joined) : null;
}

function safeGet(storage: LegacyStorage | null | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/**
 * The refresh token of a legacy session, read from the cookie first and then
 * from localStorage. Never throws; null when there is nothing usable.
 */
export function readLegacyRefreshToken(options: {
  key: string | null;
  cookieHeader: string;
  storage?: LegacyStorage | null;
}): string | null {
  if (!options.key) return null;
  const fromCookie = refreshTokenFromSessionJson(
    legacyCookieSession(parseCookieHeader(options.cookieHeader), options.key),
  );
  if (fromCookie) return fromCookie;
  return (
    refreshTokenFromSessionJson(safeGet(options.storage, options.key)) ??
    refreshTokenFromSessionJson(safeGet(options.storage, V1_STORAGE_KEY))
  );
}

/** True when any legacy session cookie or storage entry is present. */
export function hasLegacySession(options: {
  key: string | null;
  cookieHeader: string;
  storage?: LegacyStorage | null;
}): boolean {
  for (const name of parseCookieHeader(options.cookieHeader).keys()) {
    if (isLegacySessionCookie(name)) return true;
  }
  return legacyStorageKeys(options.key, options.storage).some(
    (key) => safeGet(options.storage, key) !== null,
  );
}

function legacyStorageKeys(key: string | null, storage: LegacyStorage | null | undefined) {
  const keys = new Set<string>([V1_STORAGE_KEY]);
  if (key) {
    keys.add(key);
    keys.add(`${key}-code-verifier`);
  }
  try {
    const length = storage?.length ?? 0;
    for (let i = 0; i < length; i++) {
      const name = storage?.key?.(i);
      if (name && LEGACY_STORAGE_KEY.test(name)) keys.add(name);
    }
  } catch {
    // Storage can be blocked; the explicit keys above are still tried.
  }
  return Array.from(keys);
}

/**
 * Deletes every legacy session copy this page can reach: each cookie chunk on
 * the shared parent domain and as a host-only cookie (both were written with
 * Path=/), and the localStorage entries. Never throws.
 */
export function clearLegacySession(options: {
  key: string | null;
  jar: CookieJar;
  storage?: LegacyStorage | null;
  domain?: string;
  secure: boolean;
}): void {
  const expire = (name: string, domain: string | undefined) =>
    `${name}=; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=Lax${
      domain ? `; Domain=${domain}` : ""
    }${options.secure ? "; Secure" : ""}`;

  let names: string[] = [];
  try {
    names = Array.from(parseCookieHeader(options.jar.read()).keys()).filter(isLegacySessionCookie);
  } catch {
    names = [];
  }
  for (const name of names) {
    try {
      if (options.domain) options.jar.write(expire(name, options.domain));
      options.jar.write(expire(name, undefined));
    } catch {
      // A blocked cookie jar has nothing to clear.
    }
  }

  for (const key of legacyStorageKeys(options.key, options.storage)) {
    try {
      options.storage?.removeItem(key);
    } catch {
      // Storage can be blocked; there is nothing left to clear then.
    }
  }
}
