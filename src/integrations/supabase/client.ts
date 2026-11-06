// Browser Supabase client. The auth session lives in cookies scoped to the
// parent domain shared by every site surface (mcp., docs., blog., dashboard.)
// so a sign-in on one host is visible on all of them. localStorage is
// per-origin, which is why it is no longer used for the session.
//
// Server routes never read these cookies: they authenticate with the
// `Authorization: Bearer <access token>` header that `supportFetch` and the
// other client helpers build from `supabase.auth.getSession()`.
import { createClient, type SupportedStorage } from "@supabase/supabase-js";
import { SITE_DOMAINS } from "@/lib/site-domains";
import type { Database } from "./types";

/** Cookies are rewritten on every token refresh, so this is an idle timeout. */
export const AUTH_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

/**
 * Browsers cap one cookie at 4096 bytes for name + value. Sessions with user
 * metadata exceed that, so values are split into `<key>.0`, `<key>.1`, ...
 */
export const AUTH_COOKIE_CHUNK_SIZE = 3180;

const ENCODED_PREFIX = "base64-";
const COOKIE_NAME = /^[A-Za-z0-9._-]+$/;
const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;

function isLocalHost(host: string): boolean {
  return (
    !host ||
    host === "localhost" ||
    host.endsWith(".localhost") ||
    IPV4.test(host) ||
    host.includes(":") ||
    !host.includes(".")
  );
}

/**
 * The `Domain` attribute for the auth cookies: the longest label suffix that
 * every configured surface host shares (e.g. `.n8nworkflow.com`). Returns
 * undefined (a host-only cookie) for localhost, IPs, a single origin, hosts
 * without a common registrable suffix, or a page served outside that suffix.
 */
export function sharedCookieDomain(
  hosts: readonly string[],
  currentHost: string,
): string | undefined {
  const current = currentHost.trim().toLowerCase();
  const unique = Array.from(new Set(hosts.map((host) => host.trim().toLowerCase())));
  if (isLocalHost(current) || unique.length < 2 || unique.some(isLocalHost)) return undefined;

  const labelSets = unique.map((host) => host.split(".").reverse());
  const common: string[] = [];
  for (let i = 0; ; i++) {
    const label = labelSets[0][i];
    if (!label || !labelSets.every((labels) => labels[i] === label)) break;
    common.push(label);
  }
  if (common.length < 2) return undefined;

  const suffix = common.reverse().join(".");
  if (current !== suffix && !current.endsWith(`.${suffix}`)) return undefined;
  return `.${suffix}`;
}

/** The storage key supabase-js derives by default, kept so old sessions migrate. */
export function supabaseStorageKey(supabaseUrl: string): string {
  return `sb-${new URL(supabaseUrl).hostname.split(".")[0]}-auth-token`;
}

export type CookieJar = {
  read(): string;
  write(cookie: string): void;
};

type LegacyStorage = Pick<Storage, "getItem" | "removeItem">;

export type ChunkedCookieStorageOptions = {
  domain?: string;
  secure: boolean;
  maxAgeSeconds?: number;
  chunkSize?: number;
  jar?: CookieJar;
  /** One-time migration source (the old per-origin localStorage session). */
  legacyStorage?: LegacyStorage | null;
};

export type ChunkedCookieStorage = SupportedStorage & {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
};

const documentJar: CookieJar = {
  read: () => document.cookie,
  write: (cookie) => {
    document.cookie = cookie;
  },
};

function encodeValue(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return ENCODED_PREFIX + btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeValue(value: string): string | null {
  if (!value.startsWith(ENCODED_PREFIX)) return null;
  try {
    const base64 = value.slice(ENCODED_PREFIX.length).replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(base64 + "=".repeat((4 - (base64.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function parseCookies(header: string): Map<string, string> {
  const cookies = new Map<string, string>();
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index <= 0) continue;
    const name = part.slice(0, index).trim();
    if (!cookies.has(name)) cookies.set(name, part.slice(index + 1).trim());
  }
  return cookies;
}

function chunkNames(cookies: Map<string, string>, key: string): string[] {
  const chunk = new RegExp(`^${key.replace(/\./g, "\\.")}\\.\\d+$`);
  return Array.from(cookies.keys()).filter((name) => name === key || chunk.test(name));
}

export function createChunkedCookieStorage(
  options: ChunkedCookieStorageOptions,
): ChunkedCookieStorage {
  const jar = options.jar ?? documentJar;
  const maxAge = options.maxAgeSeconds ?? AUTH_COOKIE_MAX_AGE_SECONDS;
  const chunkSize = options.chunkSize ?? AUTH_COOKIE_CHUNK_SIZE;
  const attributes = (domain: string | undefined, age: number) =>
    `; Path=/; Max-Age=${age}; SameSite=Lax${domain ? `; Domain=${domain}` : ""}${
      options.secure ? "; Secure" : ""
    }`;

  function assertKey(key: string) {
    if (!COOKIE_NAME.test(key)) throw new Error("Invalid auth storage key");
  }

  function expire(name: string) {
    jar.write(`${name}=${attributes(options.domain, 0)}`);
    // Also drop a host-only copy left by an older build or a dev session.
    if (options.domain) jar.write(`${name}=${attributes(undefined, 0)}`);
  }

  function readCookieValue(key: string): string | null {
    const cookies = parseCookies(jar.read());
    const whole = cookies.get(key);
    if (whole !== undefined) return decodeValue(whole);

    let joined = "";
    for (let i = 0; cookies.has(`${key}.${i}`); i++) joined += cookies.get(`${key}.${i}`);
    return joined ? decodeValue(joined) : null;
  }

  function setItem(key: string, value: string) {
    assertKey(key);
    const encoded = encodeValue(value);
    const chunks: string[] = [];
    for (let i = 0; i < encoded.length; i += chunkSize)
      chunks.push(encoded.slice(i, i + chunkSize));

    const written =
      chunks.length === 1
        ? [[key, chunks[0]] as const]
        : chunks.map((chunk, i) => [`${key}.${i}`, chunk] as const);
    const stale = chunkNames(parseCookies(jar.read()), key).filter(
      (name) => !written.some(([writtenName]) => writtenName === name),
    );

    for (const [name, chunk] of written) {
      // A host-only cookie with the same name would shadow the shared one.
      if (options.domain) jar.write(`${name}=${attributes(undefined, 0)}`);
      jar.write(`${name}=${chunk}${attributes(options.domain, maxAge)}`);
    }
    for (const name of stale) expire(name);
  }

  function removeItem(key: string) {
    assertKey(key);
    for (const name of chunkNames(parseCookies(jar.read()), key)) expire(name);
    try {
      options.legacyStorage?.removeItem(key);
    } catch {
      // Storage can be blocked; there is nothing left to clear then.
    }
  }

  function getItem(key: string): string | null {
    assertKey(key);
    const value = readCookieValue(key);
    if (value !== null) return value;

    let legacy: string | null = null;
    try {
      legacy = options.legacyStorage?.getItem(key) ?? null;
    } catch {
      legacy = null;
    }
    if (legacy === null) return null;

    // Move the old per-origin session into the shared cookie once. The legacy
    // copy is only dropped after the cookie reads back intact, so a browser
    // that refuses the cookie keeps the user signed in on this origin.
    setItem(key, legacy);
    if (readCookieValue(key) === legacy) {
      try {
        options.legacyStorage?.removeItem(key);
      } catch {
        // Ignore: the cookie copy now wins on every read.
      }
    }
    return legacy;
  }

  return { getItem, setItem, removeItem };
}

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

function browserLocalStorage(): LegacyStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

let _storage: ChunkedCookieStorage | undefined;
let _storageKey: string | undefined;

function browserCookieStorage(): ChunkedCookieStorage {
  if (!_storage) {
    _storage = createChunkedCookieStorage({
      domain: sharedCookieDomain(
        Object.values(SITE_DOMAINS).map((site) => site.host),
        window.location.hostname,
      ),
      secure: window.location.protocol === "https:",
      legacyStorage: browserLocalStorage(),
    });
  }
  return _storage;
}

function createSupabaseClient() {
  const { url, key } = supabaseEnv();
  const isBrowser = typeof window !== "undefined";
  _storageKey = supabaseStorageKey(url);

  return createClient<Database>(url, key, {
    auth: {
      storage: isBrowser ? browserCookieStorage() : undefined,
      storageKey: _storageKey,
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      // Implicit links (#access_token=...) work when an email is opened in a
      // different browser than the one that requested it; PKCE links do not.
      flowType: "implicit",
    },
  });
}

/**
 * Remove every auth cookie chunk on the shared parent domain (and any
 * host-only or localStorage leftovers). `signOut` calls it after Supabase's
 * own sign-out so a failed revoke never leaves a session behind.
 */
export function clearAuthSessionCookies(): void {
  if (typeof window === "undefined") return;
  const storageKey = _storageKey ?? supabaseStorageKey(supabaseEnv().url);
  browserCookieStorage().removeItem(storageKey);
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
