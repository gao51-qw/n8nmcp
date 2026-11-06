// Short-lived MCP protocol state that must survive across app replicas:
// legacy elicitations (issued → completed → replayed on a later request),
// the single-use nonces of 2026-07-28 requestState, and the client
// capabilities a legacy client declared in `initialize` for its session.
//
// MCP_SHARED_STATE=supabase keeps it in public.mcp_ephemeral_state so any
// replica can serve the follow-up request. Otherwise it lives in process
// memory, which is correct only for a single replica (and for tests).
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { Json } from "@/integrations/supabase/types";
import { createExpiringStore } from "@/lib/expiring-store";
import { log } from "@/lib/logger.server";

export type StoredElicitation = {
  fingerprint: string;
  response?: Record<string, unknown>;
};

/** Capabilities a legacy client declared at initialize (only booleans are kept). */
export type SessionCapabilities = { elicitation?: boolean; sampling?: boolean };

/** Session capabilities tracked in memory at most (oldest evicted first). */
export const MAX_TRACKED_SESSIONS = 10_000;

export interface McpSharedState {
  /** Stores (replaces) the capabilities of one user's session. */
  setSessionCapabilities(
    userId: string,
    sessionId: string,
    capabilities: SessionCapabilities,
    ttlMs: number,
  ): Promise<void>;
  /** Null when none were stored for this user + session, they expired, or the lookup failed. */
  getSessionCapabilities(userId: string, sessionId: string): Promise<SessionCapabilities | null>;
  issueElicitation(userId: string, id: string, fingerprint: string, ttlMs: number): Promise<void>;
  /** Records the user's answer. False when the id was never issued to this user or expired. */
  completeElicitation(
    userId: string,
    id: string,
    response: Record<string, unknown>,
    ttlMs: number,
  ): Promise<boolean>;
  /** Returns and removes the elicitation (single use). */
  takeElicitation(userId: string, id: string): Promise<StoredElicitation | null>;
  isRedeemed(nonce: string): Promise<boolean>;
  /** Marks a nonce used. False when it already was (another request won). */
  redeem(nonce: string, ttlMs: number): Promise<boolean>;
}

const elicitationKey = (userId: string, id: string) => `elicitation:${userId}:${id}`;
const nonceKey = (nonce: string) => `nonce:${nonce}`;
// The session id is client-controlled and unbounded: hash it so the key stays
// short (the key column allows 300 characters) and opaque.
const sessionKey = (userId: string, sessionId: string) =>
  `session:${userId}:${createHash("sha256").update(sessionId).digest("base64url")}`;

/** Keeps only boolean capability flags; anything else is dropped. */
function sessionCapabilitiesFrom(value: unknown): SessionCapabilities {
  const record = isRecord(value) ? value : {};
  const capabilities: SessionCapabilities = {};
  if (typeof record.elicitation === "boolean") capabilities.elicitation = record.elicitation;
  if (typeof record.sampling === "boolean") capabilities.sampling = record.sampling;
  return capabilities;
}

export function createMemorySharedState(
  maxEntries = 50_000,
  maxSessions = MAX_TRACKED_SESSIONS,
): McpSharedState {
  const elicitations = createExpiringStore<StoredElicitation>({ maxEntries });
  const nonces = createExpiringStore<true>({ maxEntries });
  const sessions = createExpiringStore<SessionCapabilities>({ maxEntries: maxSessions });
  return {
    async setSessionCapabilities(userId, sessionId, capabilities, ttlMs) {
      sessions.set(sessionKey(userId, sessionId), sessionCapabilitiesFrom(capabilities), ttlMs);
    },
    async getSessionCapabilities(userId, sessionId) {
      return sessions.get(sessionKey(userId, sessionId)) ?? null;
    },
    async issueElicitation(userId, id, fingerprint, ttlMs) {
      elicitations.set(elicitationKey(userId, id), { fingerprint }, ttlMs);
    },
    async completeElicitation(userId, id, response, ttlMs) {
      const key = elicitationKey(userId, id);
      const current = elicitations.get(key);
      if (!current) return false;
      elicitations.set(key, { ...current, response }, ttlMs);
      return true;
    },
    async takeElicitation(userId, id) {
      return elicitations.take(elicitationKey(userId, id)) ?? null;
    },
    async isRedeemed(nonce) {
      return nonces.get(nonceKey(nonce)) === true;
    },
    async redeem(nonce, ttlMs) {
      if (nonces.get(nonceKey(nonce))) return false;
      nonces.set(nonceKey(nonce), true, ttlMs);
      return true;
    },
  };
}

function expiresAt(ttlMs: number): string {
  return new Date(Date.now() + ttlMs).toISOString();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Supabase backend. Any database error fails closed (an answer is "not found"). */
export function createSupabaseSharedState(): McpSharedState {
  const table = () => supabaseAdmin.from("mcp_ephemeral_state");
  return {
    async setSessionCapabilities(userId, sessionId, capabilities, ttlMs) {
      // A re-initialize of the same session replaces its row (primary key).
      const { error } = await table().upsert(
        {
          key: sessionKey(userId, sessionId),
          kind: "session_capabilities",
          user_id: userId,
          value: sessionCapabilitiesFrom(capabilities) as Json,
          expires_at: expiresAt(ttlMs),
        },
        { onConflict: "key" },
      );
      if (error) throw new Error("Could not store the session capabilities");
    },
    async getSessionCapabilities(userId, sessionId) {
      const { data, error } = await table()
        .select("value")
        .eq("key", sessionKey(userId, sessionId))
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      // Fail closed: without stored capabilities the client gets the
      // confirmation-token flow instead of elicitation.
      if (error || !data) return null;
      return sessionCapabilitiesFrom(data.value);
    },
    async issueElicitation(userId, id, fingerprint, ttlMs) {
      const { error } = await table().insert({
        key: elicitationKey(userId, id),
        kind: "elicitation",
        user_id: userId,
        value: { fingerprint },
        expires_at: expiresAt(ttlMs),
      });
      if (error) throw new Error("Could not store the elicitation");
    },
    async completeElicitation(userId, id, response, ttlMs) {
      const key = elicitationKey(userId, id);
      const { data: current, error } = await table()
        .select("value")
        .eq("key", key)
        .gt("expires_at", new Date().toISOString())
        .maybeSingle();
      if (error || !current || !isRecord(current.value)) return false;
      const { error: updateError } = await table()
        .update({ value: { ...current.value, response } as Json, expires_at: expiresAt(ttlMs) })
        .eq("key", key);
      return !updateError;
    },
    async takeElicitation(userId, id) {
      // delete … returning is atomic: only one request can take a given row.
      const { data, error } = await table()
        .delete()
        .eq("key", elicitationKey(userId, id))
        .gt("expires_at", new Date().toISOString())
        .select("value");
      const value = !error && Array.isArray(data) ? data[0]?.value : null;
      if (!isRecord(value) || typeof value.fingerprint !== "string") return null;
      return {
        fingerprint: value.fingerprint,
        response: isRecord(value.response) ? value.response : undefined,
      };
    },
    async isRedeemed(nonce) {
      const { data, error } = await table().select("key").eq("key", nonceKey(nonce)).maybeSingle();
      // Fail closed: if we cannot tell, treat the state as used.
      return Boolean(error) || Boolean(data);
    },
    async redeem(nonce, ttlMs) {
      // The primary key makes the insert the arbiter: a second redeem conflicts.
      const { error } = await table().insert({
        key: nonceKey(nonce),
        kind: "request_state_nonce",
        expires_at: expiresAt(ttlMs),
      });
      return !error;
    },
  };
}

let shared: McpSharedState | null = null;

export function mcpSharedState(): McpSharedState {
  if (!shared) {
    const supabase = process.env.MCP_SHARED_STATE === "supabase";
    if (!supabase && process.env.NODE_ENV === "production") {
      log.warn("mcp.shared_state.memory", {
        message:
          "MCP elicitation, requestState and session-capability state is per process; set MCP_SHARED_STATE=supabase before running more than one app replica.",
      });
    }
    shared = supabase ? createSupabaseSharedState() : createMemorySharedState();
  }
  return shared;
}

/** Test hook. */
export function setMcpSharedStateForTests(state: McpSharedState | null): void {
  shared = state;
}

/** Deletes expired rows; called from the support maintenance cron. */
export async function pruneMcpEphemeralState(): Promise<number> {
  if (process.env.MCP_SHARED_STATE !== "supabase") return 0;
  const { data, error } = await supabaseAdmin.rpc("prune_mcp_ephemeral_state");
  if (error) {
    log.warn("mcp.shared_state.prune_failed", { error: error.message });
    return 0;
  }
  return typeof data === "number" ? data : 0;
}
