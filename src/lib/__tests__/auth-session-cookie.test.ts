import { describe, expect, it } from "vitest";
import { supabaseStorageKey } from "@/lib/auth/legacy-session";
import {
  authSessionCookieKey,
  cookieNames,
  hasAuthSessionCookie,
  hasLegacySessionCookie,
  SESSION_PRESENCE_COOKIE,
} from "@/lib/auth-session-cookie";

describe("auth session cookie presence", () => {
  const key = "sb-abcdefgh-auth-token";

  it("uses the legacy supabase-js key for the migration window", () => {
    expect(authSessionCookieKey("https://abcdefgh.supabase.co")).toBe(
      supabaseStorageKey("https://abcdefgh.supabase.co"),
    );
    expect(authSessionCookieKey(undefined)).toBeNull();
    expect(authSessionCookieKey("not a url")).toBeNull();
  });

  it("accepts the HttpOnly presence marker", () => {
    expect(SESSION_PRESENCE_COOKIE).toBe("n8nmcp-session");
    expect(hasAuthSessionCookie(["n8nmcp-session"], key)).toBe(true);
    expect(hasAuthSessionCookie(["theme", "n8nmcp-session"], null)).toBe(true);
    // The refresh cookie is Path=/api/auth and never reaches page requests.
    expect(hasAuthSessionCookie(["n8nmcp-rt"], key)).toBe(false);
  });

  it("accepts an unchunked legacy cookie or the first chunk only", () => {
    expect(hasAuthSessionCookie([key], key)).toBe(true);
    expect(hasAuthSessionCookie([`${key}.0`, `${key}.1`], key)).toBe(true);
    expect(hasAuthSessionCookie([`${key}.1`], key)).toBe(false);
    expect(hasAuthSessionCookie([`${key}-code-verifier`], key)).toBe(false);
    expect(hasAuthSessionCookie(["sb-other-auth-token.0"], key)).toBe(false);
    expect(hasAuthSessionCookie([], key)).toBe(false);
  });

  it("accepts any project's legacy cookie when the key is unknown", () => {
    expect(hasLegacySessionCookie(["sb-other-auth-token.0"], null)).toBe(true);
    expect(hasLegacySessionCookie(["sb-other-auth-token"], null)).toBe(true);
    expect(hasLegacySessionCookie(["sb-other-auth-token.1", "theme=dark"], null)).toBe(false);
  });

  it("parses cookie names from a Cookie header or document.cookie", () => {
    expect(cookieNames(`a=1; ${key}.0=base64-x=y; flag`)).toEqual(["a", `${key}.0`]);
    expect(cookieNames("")).toEqual([]);
  });
});
