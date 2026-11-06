// Tool error text that is safe to show to MCP clients and to persist in
// mcp_call_logs.error_message. Full exception detail goes to Sentry/logger only.

/**
 * The confirmation challenge a client must echo back to run a destructive
 * tool. The token is a one-time, user-scoped, short-lived value issued for
 * this client, so it has to reach it; the generic secret filter below would
 * otherwise drop the whole message because it contains "confirmationToken".
 */
const CONFIRMATION_PROMPT =
  /^[A-Z][A-Za-z ]{2,80} requires (?:a valid )?confirmation(?: token)?\. Re-send with \{"confirm": true, "confirmationToken": "mcp_confirm_[A-Za-z0-9_-]{16,64}"\} to proceed\.$/;

export function sanitizedToolErrorMessage(message: string): string | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 300) return null;
  if (CONFIRMATION_PROMPT.test(normalized)) return normalized;
  if (/(api[-_ ]?key|authorization|bearer|cookie|password|secret|token)/i.test(normalized)) {
    return null;
  }
  if (
    /\b(is|are) required\b/i.test(normalized) ||
    /\belicitation\b/i.test(normalized) ||
    /\brequires confirmation\b/i.test(normalized) ||
    /\bmust be\b/i.test(normalized) ||
    /\bunsupported\b/i.test(normalized) ||
    /\binvalid\b/i.test(normalized) ||
    /\bvalidation failed\b/i.test(normalized) ||
    /\bnot configured\b/i.test(normalized) ||
    /\bnot yet supported\b/i.test(normalized) ||
    // Fixed workflow-agent conflict texts (see workflow-agent/action-conflict.ts).
    /\bchanged since\b/i.test(normalized) ||
    /\bwas not applied\b/i.test(normalized)
  ) {
    return normalized;
  }
  return null;
}

const GENERIC_FAILURE = "Tool execution failed";

/**
 * The error text to persist for a thrown tool error: the sanitized message, or
 * a generic fallback that names only the error class (never its message).
 */
export function persistedToolErrorMessage(error: unknown, fallback = GENERIC_FAILURE): string {
  const message = error instanceof Error ? error.message : "";
  const safe = message ? sanitizedToolErrorMessage(message) : null;
  if (safe) return safe;
  const className = error instanceof Error ? error.name : "";
  return className && className !== "Error" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(className)
    ? `${fallback} (${className})`
    : fallback;
}
