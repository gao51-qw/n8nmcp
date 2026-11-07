// Tool error text that is safe to show to MCP clients and to persist in
// mcp_call_logs.error_message. Full exception detail goes to Sentry/logger only.

import {
  ALREADY_ROLLED_BACK_MESSAGE,
  AUDIT_ALREADY_ROLLED_BACK_MESSAGE,
  AUDIT_INSTANCE_MISMATCH_MESSAGE,
  AUDIT_LOG_NOT_FOUND_MESSAGE,
  CONCURRENT_WRITE_DETECTED_MESSAGE,
  PREVIEW_INSTANCE_MISMATCH_MESSAGE,
  PREVIEW_STALE_MESSAGE,
  ROLLBACK_CONFLICT_MESSAGE,
  ROLLBACK_UNVERIFIABLE_MESSAGE,
} from "@/lib/workflow-agent/action-conflict";

/**
 * The confirmation challenge a client must echo back to run a destructive
 * tool. The token is a one-time, user-scoped, short-lived value issued for
 * this client, so it has to reach it; the generic secret filter below would
 * otherwise drop the whole message because it contains "confirmationToken".
 */
const CONFIRMATION_PROMPT =
  /^[A-Z][A-Za-z ]{2,80} requires (?:a valid )?confirmation(?: token)?\. Re-send with \{"confirm": true, "confirmationToken": "mcp_confirm_[A-Za-z0-9_-]{16,64}"\} to proceed\.$/;

/**
 * Fixed workflow-agent error texts (no interpolated values) that tell the
 * caller what to do next. Matched exactly, so the secret filter below is not
 * loosened for anything else.
 */
const FIXED_WORKFLOW_AGENT_MESSAGES: ReadonlySet<string> = new Set([
  // action-conflict.ts
  PREVIEW_INSTANCE_MISMATCH_MESSAGE,
  AUDIT_INSTANCE_MISMATCH_MESSAGE,
  ROLLBACK_CONFLICT_MESSAGE,
  ROLLBACK_UNVERIFIABLE_MESSAGE,
  ALREADY_ROLLED_BACK_MESSAGE,
  PREVIEW_STALE_MESSAGE,
  AUDIT_LOG_NOT_FOUND_MESSAGE,
  AUDIT_ALREADY_ROLLED_BACK_MESSAGE,
  // Post-write concurrency warning (mcp/write-verification.server.ts).
  CONCURRENT_WRITE_DETECTED_MESSAGE,
  // trusted-preview.server.ts
  "Workflow preview is stale",
  "Trusted workflow preview not found",
  "Workflow preview session does not match the current session",
  "Workflow preview scope does not match the requested workflow",
  "Workflow operations do not match the trusted preview",
  "Workflow preview selection requires at least one operation",
  "Workflow preview operation index is outside the allowed range",
  // rollback_workflow (mcp/rollback.server.ts / audit.server.ts)
  "Rollback snapshot workflow id does not match the audit record",
  "Cannot rollback: no snapshot_before available",
]);

export function sanitizedToolErrorMessage(message: string): string | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 300) return null;
  if (CONFIRMATION_PROMPT.test(normalized)) return normalized;
  if (FIXED_WORKFLOW_AGENT_MESSAGES.has(normalized)) return normalized;
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
