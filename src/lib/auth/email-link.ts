// Supabase email links (sign-up confirmation, password recovery) use the
// implicit flow, so they return to the app with the session in the URL
// fragment: `#access_token=…&refresh_token=…&expires_at=…&type=recovery`.
// Implicit links keep working when the email is opened in a different browser
// than the one that asked for it; PKCE links do not.
//
// The fragment never reaches a server. The browser strips it from the address
// bar immediately and posts the tokens once to /api/auth/exchange, which moves
// the refresh token into the HttpOnly cookie.

const TOKEN = /^[\x21-\x7e]{1,4096}$/;

export type EmailLinkTokens = {
  access_token: string;
  refresh_token: string;
  type: string | null;
};

/** The tokens in an implicit-flow fragment, or null when there are none. */
export function parseEmailLinkFragment(hash: string): EmailLinkTokens | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const accessToken = params.get("access_token");
  const refreshToken = params.get("refresh_token");
  if (!accessToken || !refreshToken) return null;
  if (!TOKEN.test(accessToken) || !TOKEN.test(refreshToken)) return null;
  return { access_token: accessToken, refresh_token: refreshToken, type: params.get("type") };
}

/**
 * The fragment with every token parameter removed. Error parameters
 * (`error`, `error_description`) stay for the page to show.
 */
export function fragmentWithoutTokens(hash: string): string {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  for (const name of [
    "access_token",
    "refresh_token",
    "provider_token",
    "provider_refresh_token",
    "expires_at",
    "expires_in",
    "token_type",
    "type",
  ]) {
    params.delete(name);
  }
  const rest = params.toString();
  return rest ? `#${rest}` : "";
}
