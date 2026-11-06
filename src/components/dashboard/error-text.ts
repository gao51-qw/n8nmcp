// One place to turn a failed dashboard request into a message for the user.
//
// `supportFetch` throws an Error whose message is meant to be readable. Older
// builds put the raw response body in that message instead, either
// `{"error":"..."}` or `{"error":{"code":"...","message":"..."}}`, so a JSON
// message is unwrapped before it reaches the page.

const DEFAULT_FALLBACK = "Something went wrong. Try again.";

function messageFromJson(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const { error, message } = parsed as { error?: unknown; message?: unknown };
  if (typeof error === "string" && error.trim()) return error;
  if (error && typeof error === "object") {
    const nested = (error as { message?: unknown }).message;
    if (typeof nested === "string" && nested.trim()) return nested;
  }
  if (typeof message === "string" && message.trim()) return message;
  // A JSON body without a readable message is not shown to the user.
  return "";
}

export function errorText(error: unknown, fallback = DEFAULT_FALLBACK): string {
  const raw =
    error instanceof Error ? error.message : typeof error === "string" ? error : undefined;
  if (!raw || !raw.trim()) return fallback;
  const fromJson = messageFromJson(raw);
  if (fromJson === null) return raw;
  return fromJson || fallback;
}
