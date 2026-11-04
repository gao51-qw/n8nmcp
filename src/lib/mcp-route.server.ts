// MCP Streamable HTTP gateway endpoint handler.
//
// Dual-era: legacy clients (initialize handshake, 2025-06-18) and modern
// clients (per-request _meta, 2026-07-28) share this endpoint and the same
// tool dispatch. mcp-protocol.server.ts decides the era per request.
// Specs: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
//        https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http
import { randomBytes } from "node:crypto";
import {
  authenticateBearer,
  checkDailyQuota,
  checkShortWindowQuota,
  ElicitationRequiredError,
  type ToolContext,
  dispatchTool,
  getDefaultInstance,
  getMergedTools,
  recordCall,
} from "@/lib/mcp.server";
import * as Sentry from "@sentry/nextjs";
import { isUpstreamConfigured } from "@/lib/mcp-upstream.server";
import { getRequestId, log } from "@/lib/logger.server";
import { CORS, jsonResp, rpcError, rpcResult, sseStream } from "@/lib/mcp-transport.server";
import type { JsonRpcReq } from "@/lib/mcp-types";
import {
  buildWorkflowAgentCallMetadata,
  toolBusinessOutcome,
  workflowIdFromCall,
} from "@/lib/workflow-agent/call-metadata.server";
import { createExpiringStore } from "@/lib/expiring-store";
import {
  classifyRequest,
  discoverResult,
  LEGACY_PROTOCOL_VERSION,
  looksModern,
  type ModernRequest,
  modernErrorStatus,
  modernResult,
  SERVER_INFO,
  supportsFormElicitation,
} from "@/lib/mcp-protocol.server";
import {
  confirmationFingerprint,
  InvalidRequestStateError,
  redeemRequestState,
  signRequestState,
  type VerifiedRequestState,
  verifyRequestState,
} from "@/lib/mcp-request-state.server";

/** Protocol context of one JSON-RPC message. */
type Era = { era: "legacy" } | ModernRequest;

const SERVER_NOTES = () =>
  isUpstreamConfigured()
    ? "local management + self-hosted n8n-knowledge-mcp upstream"
    : "local-only (upstream knowledge base not configured)";

/** Cache hint for tools/list: the tool set changes only on deploys. */
const TOOLS_LIST_TTL_MS = 300_000;
/** Key of the single confirmation in an InputRequiredResult. */
const CONFIRM_INPUT_KEY = "confirm";
/** Methods that exist only in the legacy (initialize-based) protocol. */
const LEGACY_ONLY_METHODS = new Set([
  "initialize",
  "notifications/initialized",
  "ping",
  "logging/setLevel",
  "notifications/elicitation/complete",
]);

const ROBOTS_NOINDEX = "noindex,nofollow";
const CLIENT_CAPABILITIES_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ELICITATION_TTL_MS = 5 * 60_000;
const MAX_TRACKED_SESSIONS = 10_000;
const MAX_TRACKED_ELICITATIONS = 10_000;
const clientCapabilitySessions = createExpiringStore<ToolContext["clientCapabilities"]>({
  maxEntries: MAX_TRACKED_SESSIONS,
});
// Elicitations the server has issued, keyed by user + id. A completion is only
// accepted for an id issued to the same user, and a replay only satisfies the
// exact request (title + description) that id was issued for.
const issuedElicitations = createExpiringStore<{ fingerprint: string }>({
  maxEntries: MAX_TRACKED_ELICITATIONS,
});
const elicitationResponses = createExpiringStore<Record<string, unknown>>({
  maxEntries: MAX_TRACKED_ELICITATIONS,
});

type ElicitationRequest = {
  title: string;
  description: string;
  details?: string;
  schema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
};

function buildElicitationId() {
  return `elicitation_${randomBytes(12).toString("base64url")}`;
}

function elicitationKey(userId: string, elicitationId: string) {
  return `${userId}:${elicitationId}`;
}

function elicitationFingerprint(request: ElicitationRequest) {
  return JSON.stringify([request.title, request.description]);
}

/**
 * Normalises a `notifications/elicitation/complete` payload.
 *
 * MCP shape: `{ action: "accept" | "decline" | "cancel", content?: {...} }`.
 * Decline/cancel are recorded as an empty response so confirmation checks
 * (`confirm === true`) fail closed. The pre-spec shape `{ action: {...} }`
 * is still accepted as an implicit accept.
 */
function parseElicitationCompletion(
  params: Record<string, unknown>,
): Record<string, unknown> | null {
  const action = params.action;
  if (typeof action === "string") {
    if (action === "decline" || action === "cancel") return {};
    if (action !== "accept") return null;
    const content = asRecord(params.content);
    return Object.keys(content).length > 0 ? content : null;
  }
  const legacy = asRecord(action);
  return Object.keys(legacy).length > 0 ? legacy : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function parseClientCapabilities(
  params: Record<string, unknown>,
): ToolContext["clientCapabilities"] {
  const initCaps = asRecord(params.clientCapabilities);
  const legacyCaps = asRecord(params.capabilities);
  const expCaps = asRecord(asRecord(params).experimental).clientCapabilities;
  const candidate =
    Object.keys(initCaps).length > 0
      ? initCaps
      : Object.keys(legacyCaps).length > 0
        ? legacyCaps
        : asRecord(expCaps);
  return {
    elicitation: typeof candidate.elicitation === "boolean" ? candidate.elicitation : undefined,
    sampling: typeof candidate.sampling === "boolean" ? candidate.sampling : undefined,
  };
}

function buildSessionKey(userId: string, request: Request, sessionId: string | null): string {
  const mcpSession = request.headers.get("mcp-session-id") || request.headers.get("x-session-id");
  return `${userId}:${sessionId || mcpSession || "default"}`;
}

function storeSessionCapabilities(
  userId: string,
  sessionId: string | null,
  request: Request,
  capabilities: ToolContext["clientCapabilities"],
) {
  const key = buildSessionKey(userId, request, sessionId);
  clientCapabilitySessions.set(key, capabilities, CLIENT_CAPABILITIES_SESSION_TTL_MS);
}

function loadSessionCapabilities(
  userId: string,
  sessionId: string | null,
  request: Request,
): ToolContext["clientCapabilities"] | null {
  return clientCapabilitySessions.get(buildSessionKey(userId, request, sessionId)) ?? null;
}

function resolveToolContext(
  userId: string,
  request: Request,
  sessionId: string | null,
  requestParams: Record<string, unknown>,
): ToolContext {
  const capabilitiesFromSession = loadSessionCapabilities(userId, sessionId, request) ?? {};
  const capabilityCandidate = parseClientCapabilities(requestParams);
  const clientCapabilities = {
    ...capabilitiesFromSession,
    ...capabilityCandidate,
  };

  // A replay must name an elicitation the server issued to this user. Inline
  // answers without an issued id are ignored: accepting them would let a
  // client skip the confirmation prompt entirely.
  const replay = asRecord(asRecord(requestParams).elicitationResponse);
  const replayId = String(replay.elicitationId ?? "").trim();
  if (replayId) {
    const key = elicitationKey(userId, replayId);
    return {
      clientCapabilities,
      requestElicitation: async (elicitationRequest: ElicitationRequest) => {
        const issued = issuedElicitations.take(key);
        const response = elicitationResponses.take(key);
        if (!issued || !response) {
          throw new Error(
            `Missing elicitation response for ${replayId}. Re-run notifications/elicitation/complete.`,
          );
        }
        if (issued.fingerprint !== elicitationFingerprint(elicitationRequest)) {
          throw new Error(
            `Elicitation ${replayId} was issued for a different request; retry without elicitationResponse to get a new one.`,
          );
        }
        return response;
      },
    };
  }

  const requestElicitation =
    clientCapabilities?.elicitation === true
      ? async (elicitationRequest: ElicitationRequest) => {
          const elicitationId = buildElicitationId();
          issuedElicitations.set(
            elicitationKey(userId, elicitationId),
            { fingerprint: elicitationFingerprint(elicitationRequest) },
            ELICITATION_TTL_MS,
          );
          throw new ElicitationRequiredError(elicitationId, {
            ...elicitationRequest,
            details: `Provide confirmation via notifications/elicitation/complete. Then retry with elicitationResponse: {elicitationId: "${elicitationId}"}.`,
          });
        }
      : undefined;

  return {
    clientCapabilities,
    requestElicitation,
  };
}

/**
 * Tool context for a modern (2026-07-28) tools/call. Confirmation uses Multi
 * Round-Trip Requests: the first call is answered with an InputRequiredResult
 * (see the ElicitationRequiredError branch in handleRpc) and the client
 * retries with `inputResponses` plus the signed `requestState`. No process
 * memory is needed beyond the redeemed-nonce set. Clients that do not declare
 * form elicitation get no requestElicitation and fall back to the
 * confirmation-token flow, exactly like legacy clients without elicitation.
 */
function resolveModernToolContext(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  modern: ModernRequest,
  params: Record<string, unknown>,
): { toolContext: ToolContext } | { error: string } {
  const canElicit = supportsFormElicitation(modern.clientCapabilities);
  const clientCapabilities = { elicitation: canElicit };
  if (!canElicit) return { toolContext: { clientCapabilities } };

  let verified: VerifiedRequestState | null = null;
  if (params.requestState !== undefined) {
    try {
      verified = verifyRequestState(params.requestState, { userId, tool, args });
    } catch (error) {
      if (error instanceof InvalidRequestStateError) return { error: error.message };
      throw error;
    }
  }
  const responses = asRecord(params.inputResponses);

  return {
    toolContext: {
      clientCapabilities,
      requestElicitation: async (elicitationRequest: ElicitationRequest) => {
        if (verified && verified.fingerprint === confirmationFingerprint(elicitationRequest)) {
          const answer = asRecord(responses[verified.key]);
          if (
            answer.action === "accept" ||
            answer.action === "decline" ||
            answer.action === "cancel"
          ) {
            redeemRequestState(verified);
            // Decline/cancel yield an empty answer so confirmation fails closed.
            return answer.action === "accept" ? asRecord(answer.content) : {};
          }
        }
        // No (usable) answer for this confirmation yet: ask for it. Per MRTR,
        // a missing response is answered with a fresh InputRequiredResult.
        throw new ElicitationRequiredError(CONFIRM_INPUT_KEY, elicitationRequest);
      },
    },
  };
}

function inputRequiredResult(
  userId: string,
  tool: string,
  args: Record<string, unknown>,
  error: ElicitationRequiredError,
) {
  const { title, description, details, schema } = error.request;
  return {
    resultType: "input_required",
    inputRequests: {
      [error.elicitationId]: {
        method: "elicitation/create",
        params: {
          mode: "form",
          message: [title, description, details].filter(Boolean).join("\n\n"),
          requestedSchema: schema,
        },
      },
    },
    requestState: signRequestState(
      { userId, tool, args },
      { key: error.elicitationId, fingerprint: confirmationFingerprint(error.request) },
    ),
  };
}

function withNoIndex(response: Response): Response {
  response.headers.set("X-Robots-Tag", ROBOTS_NOINDEX);
  return response;
}

function withRequestId(response: Response, requestId: string): Response {
  response.headers.set("x-request-id", requestId);
  return withNoIndex(response);
}

function sanitizedToolErrorMessage(message: string): string | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 300) return null;
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
    /\bnot yet supported\b/i.test(normalized)
  ) {
    return normalized;
  }
  return null;
}

async function handleRpc(
  req: JsonRpcReq,
  ctx: Awaited<ReturnType<typeof authenticateBearer>>,
  source: { ip: string; ua: string; request_id: string },
  request: Request,
  sessionId: string | null,
  era: Era = { era: "legacy" },
): Promise<unknown> {
  if (!ctx) return rpcError(req.id, -32001, "Unauthorized");
  const modern = era.era === "modern" ? era : null;
  const protocolLog = {
    protocol_version: modern?.version ?? LEGACY_PROTOCOL_VERSION,
    ...(modern?.mcpName ? { mcp_name: modern.mcpName } : {}),
    ...(modern?.clientInfo?.name ? { client_name: modern.clientInfo.name } : {}),
  };

  // 2026-07-28 removed the handshake, ping, logging/setLevel and the
  // elicitation completion notification; server/discover is modern-only.
  if (modern && LEGACY_ONLY_METHODS.has(req.method)) {
    return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
  if (!modern && req.method === "server/discover") {
    return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }

  switch (req.method) {
    case "initialize":
      if (req.params) {
        const capabilities = parseClientCapabilities(asRecord(req.params));
        storeSessionCapabilities(ctx.user_id, sessionId, request, capabilities);
      }
      return rpcResult(req.id, {
        protocolVersion: LEGACY_PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { ...SERVER_INFO, notes: SERVER_NOTES() },
      });

    case "ping":
    case "notifications/initialized":
      return rpcResult(req.id, {});

    case "server/discover":
      return rpcResult(req.id, discoverResult(SERVER_NOTES()));

    case "tools/list": {
      const t0 = Date.now();
      const tools = await getMergedTools();
      log.info("mcp.gateway.request", {
        method: "tools/list",
        user_id: ctx.user_id,
        key_id: ctx.key_id,
        ip: source.ip,
        ua: source.ua,
        request_id: source.request_id,
        latency_ms: Date.now() - t0,
        tool_count: tools.length,
        ...protocolLog,
      });
      // ttlMs/cacheScope are required by 2026-07-28 and ignored by older
      // clients. "private": the result is served per authenticated key.
      return rpcResult(req.id, { tools, ttlMs: TOOLS_LIST_TTL_MS, cacheScope: "private" });
    }

    case "notifications/elicitation/complete": {
      const params = asRecord(req.params);
      const elicitationId = String(params.elicitationId ?? "").trim();
      if (!elicitationId) {
        return rpcError(req.id, -32602, "Missing elicitationId");
      }
      const completion = parseElicitationCompletion(params);
      if (!completion) {
        return rpcError(req.id, -32602, "Missing elicitation response payload");
      }
      const key = elicitationKey(ctx.user_id, elicitationId);
      if (!issuedElicitations.get(key)) {
        return rpcError(req.id, -32602, "Unknown or expired elicitationId");
      }
      elicitationResponses.set(key, completion, ELICITATION_TTL_MS);
      return rpcResult(req.id, { ok: true, elicitationId });
    }

    case "tools/call": {
      const params = req.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const started = Date.now();
      let toolContext: ToolContext;
      if (modern) {
        const resolved = resolveModernToolContext(ctx.user_id, name, args, modern, params);
        if ("error" in resolved) {
          log.warn("mcp.gateway.request", {
            method: "tools/call",
            tool: name,
            user_id: ctx.user_id,
            key_id: ctx.key_id,
            request_id: source.request_id,
            status: "invalid_request_state",
            err: resolved.error,
            ...protocolLog,
          });
          return rpcError(req.id, -32602, `Invalid params: ${resolved.error}`);
        }
        toolContext = resolved.toolContext;
      } else {
        toolContext = resolveToolContext(ctx.user_id, request, sessionId, params);
      }
      const inst = await getDefaultInstance(ctx.user_id);

      try {
        const result = await dispatchTool(name, args, inst, {
          user_id: ctx.user_id,
          key_id: ctx.key_id,
          source: "tools/call",
          ip: source.ip,
          ua: source.ua,
          request_id: source.request_id,
          session_id: sessionId ?? undefined,
          ...toolContext,
        });

        if (result.needsInstance) {
          await recordCall({
            user_id: ctx.user_id,
            tool_name: name,
            status: "error",
            latency_ms: Date.now() - started,
            error_message: "no n8n instance configured",
            upstream: result.upstream,
            category: result.category,
            workflow_id: workflowIdFromCall(name, args, result.output),
            session_id: sessionId,
          });
          log.warn("mcp.gateway.request", {
            method: "tools/call",
            tool: name,
            user_id: ctx.user_id,
            key_id: ctx.key_id,
            ip: source.ip,
            ua: source.ua,
            request_id: source.request_id,
            latency_ms: Date.now() - started,
            status: "needs_instance",
            upstream: result.upstream,
            category: result.category,
            ...protocolLog,
          });
          // 2026-07-28 reserves -32002 (old "resource not found") and forbids
          // emitting it, so modern clients get a tool error the model can read.
          if (modern) {
            return rpcResult(req.id, {
              content: [
                {
                  type: "text",
                  text: "No n8n instance is configured for this account. Add one in the dashboard, then retry.",
                },
              ],
              isError: true,
            });
          }
          return rpcError(req.id, -32002, "No n8n instance configured for this user");
        }

        const outcome = toolBusinessOutcome(result.output);
        const businessErrorMessage =
          outcome.success === false
            ? sanitizedToolErrorMessage(outcome.errorMessage ?? "Tool reported a business failure")
            : null;
        await recordCall({
          user_id: ctx.user_id,
          instance_id: inst?.id ?? null,
          tool_name: name,
          status: outcome.success === false ? "error" : "ok",
          error_message: businessErrorMessage,
          latency_ms: Date.now() - started,
          upstream: result.upstream,
          category: result.category,
          workflow_id: workflowIdFromCall(name, args, result.output),
          session_id: sessionId,
          metadata: buildWorkflowAgentCallMetadata(name, args, result.output),
        });
        log.info("mcp.gateway.request", {
          method: "tools/call",
          tool: name,
          user_id: ctx.user_id,
          key_id: ctx.key_id,
          ip: source.ip,
          ua: source.ua,
          request_id: source.request_id,
          latency_ms: Date.now() - started,
          status: outcome.success === false ? "error" : "ok",
          upstream: result.upstream,
          category: result.category,
          ...protocolLog,
        });

        if (outcome.success === false) {
          return rpcResult(req.id, {
            content: [{ type: "text", text: JSON.stringify(result.output, null, 2) }],
            isError: true,
          });
        }
        if (result.upstream && result.output && typeof result.output === "object") {
          return rpcResult(req.id, result.output);
        }
        return rpcResult(req.id, {
          content: [{ type: "text", text: JSON.stringify(result.output, null, 2) }],
          isError: false,
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "tool failed";
        const safeMsg = sanitizedToolErrorMessage(msg);
        if (e instanceof ElicitationRequiredError && modern) {
          log.info("mcp.gateway.request", {
            method: "tools/call",
            tool: name,
            user_id: ctx.user_id,
            key_id: ctx.key_id,
            request_id: source.request_id,
            latency_ms: Date.now() - started,
            status: "input_required",
            ...protocolLog,
          });
          return rpcResult(req.id, inputRequiredResult(ctx.user_id, name, args, e));
        }
        if (e instanceof ElicitationRequiredError) {
          return rpcResult(req.id, {
            isError: true,
            code: "elicitation_required",
            request: {
              elicitationId: e.elicitationId,
              title: e.request.title,
              description: e.request.description,
              details: e.request.details,
              schema: e.request.schema,
            },
            message: safeMsg ?? msg,
          });
        }
        const sentryEventId = Sentry.captureException(e, {
          tags: {
            request_id: source.request_id,
            mcp_tool: name,
          },
          user: { id: ctx.user_id },
        });
        await recordCall({
          user_id: ctx.user_id,
          instance_id: inst?.id ?? null,
          tool_name: name,
          status: "error",
          latency_ms: Date.now() - started,
          error_message: msg,
          workflow_id: workflowIdFromCall(name, args, null),
          session_id: sessionId,
        });
        log.warn("mcp.gateway.request", {
          method: "tools/call",
          tool: name,
          user_id: ctx.user_id,
          key_id: ctx.key_id,
          ip: source.ip,
          ua: source.ua,
          request_id: source.request_id,
          latency_ms: Date.now() - started,
          status: "error",
          err: msg,
          sentry_event_id: sentryEventId,
          ...protocolLog,
        });
        return rpcResult(req.id, {
          content: [
            {
              type: "text",
              text: [
                "Tool execution failed.",
                safeMsg ? `Error: ${safeMsg}` : null,
                `Request ID: ${source.request_id}.`,
                sentryEventId ? `Sentry event ID: ${sentryEventId}.` : null,
              ]
                .filter(Boolean)
                .join(" "),
            },
          ],
          isError: true,
        });
      }
    }

    default:
      return rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

function requestSource(request: Request) {
  const ip =
    request.headers.get("cf-connecting-ip") ||
    request.headers.get("x-real-ip") ||
    (request.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() ||
    "unknown";
  const ua = (request.headers.get("user-agent") ?? "").slice(0, 200);
  return { ip, ua };
}

// Hard ceiling on JSON-RPC batch size. Without this, a single authenticated POST
// could carry an unbounded array of tools/call entries.
const MAX_BATCH_SIZE = 10;

// Only tools/call performs billable work (n8n / upstream calls + usage increment).
// initialize / ping / tools/list still pass through the short-window throttle.
function isBillableMethod(method: string): boolean {
  return method === "tools/call";
}

export async function mcpOptions(request: Request) {
  return withRequestId(new Response(null, { status: 204, headers: CORS }), getRequestId(request));
}

export async function mcpGet(request: Request) {
  return withRequestId(
    new Response("Use POST with JSON-RPC body", {
      status: 405,
      headers: { Allow: "POST, OPTIONS", ...CORS },
    }),
    getRequestId(request),
  );
}

/**
 * Applies the short-window throttle and, for billable methods, the daily
 * quota. Returns the JSON-RPC error to send, or null when the call may run.
 * Enforced per RPC so a batch of N tool calls costs N tokens.
 */
async function throttle(
  auth: NonNullable<Awaited<ReturnType<typeof authenticateBearer>>>,
  r: JsonRpcReq,
): Promise<ReturnType<typeof rpcError> | null> {
  if (!(await checkShortWindowQuota(auth.user_id))) {
    await recordCall({
      user_id: auth.user_id,
      tool_name: null,
      status: "rate_limited",
      latency_ms: 0,
      error_message: "short-window throttle",
    });
    return rpcError(r.id ?? null, -32003, "Rate limit exceeded (60 req / 10s)");
  }

  if (isBillableMethod(r.method)) {
    // Re-read before each billable call; recordCall() in handleRpc has already
    // incremented usage for any prior call in a sequential batch.
    const quota = await checkDailyQuota(auth);
    if (!quota.ok) {
      await recordCall({
        user_id: auth.user_id,
        tool_name: null,
        status: "rate_limited",
        latency_ms: 0,
        error_message: `daily quota exceeded (${quota.used}/${quota.limit})`,
      });
      return rpcError(r.id ?? null, -32004, `Daily quota exceeded (${quota.used}/${quota.limit})`);
    }
  }
  return null;
}

function isValidMessage(r: unknown): r is JsonRpcReq {
  const candidate = r as JsonRpcReq | null;
  return !!candidate && candidate.jsonrpc === "2.0" && typeof candidate.method === "string";
}

/**
 * Serves one modern (2026-07-28) request statelessly: no session headers,
 * results carry resultType + serverInfo, and protocol errors use the HTTP
 * statuses the Streamable HTTP binding requires.
 */
async function serveModern(
  r: JsonRpcReq,
  era: ModernRequest,
  auth: NonNullable<Awaited<ReturnType<typeof authenticateBearer>>>,
  source: { ip: string; ua: string; request_id: string },
  request: Request,
  requestId: string,
): Promise<Response> {
  // 2026-07-28 defines no client-to-server notifications over HTTP; accept and ignore.
  if (r.id === undefined || r.id === null) {
    return withRequestId(new Response(null, { status: 202, headers: CORS }), requestId);
  }

  const out = (await throttle(auth, r)) ?? (await handleRpc(r, auth, source, request, null, era));
  const payload = out as { result?: unknown; error?: { code?: number } };
  if (payload.error) {
    return withRequestId(jsonResp(payload, modernErrorStatus(payload.error.code ?? 0)), requestId);
  }
  return withRequestId(jsonResp({ ...payload, result: modernResult(payload.result) }), requestId);
}

export async function mcpPost(request: Request) {
  const requestId = getRequestId(request);
  const auth = await authenticateBearer(request);
  const source = { ...requestSource(request), request_id: requestId };
  const sessionId = request.headers.get("mcp-session-id") || request.headers.get("x-session-id");

  if (!auth) {
    log.warn("mcp.gateway.unauthorized", source);
    return withRequestId(
      jsonResp(rpcError(null, -32001, "Unauthorized: invalid or missing Bearer key"), 401),
      requestId,
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return withRequestId(jsonResp(rpcError(null, -32700, "Parse error"), 400), requestId);
  }

  if (!Array.isArray(body) && isValidMessage(body)) {
    const era = classifyRequest(body, request.headers);
    if (era.era === "invalid") {
      const { status, code, message, data } = era.error;
      return withRequestId(
        jsonResp(rpcError(body.id ?? null, code, message, data), status),
        requestId,
      );
    }
    if (era.era === "modern") {
      return serveModern(body, era, auth, source, request, requestId);
    }
  }

  const wantsSse = (request.headers.get("accept") ?? "").includes("text/event-stream");
  const isBatch = Array.isArray(body);
  const batch = (Array.isArray(body) ? body : [body]) as JsonRpcReq[];

  if (batch.length === 0) {
    return withRequestId(
      jsonResp(rpcError(null, -32600, "Invalid Request: empty batch"), 400),
      requestId,
    );
  }
  // Modern Streamable HTTP carries exactly one message per POST.
  if (
    isBatch &&
    (looksModern(null, request.headers) || batch.some((r) => looksModern(r, request.headers)))
  ) {
    return withRequestId(
      jsonResp(
        rpcError(null, -32600, "Invalid Request: batches are not supported in protocol 2026-07-28"),
        400,
      ),
      requestId,
    );
  }
  // Reject oversized batches outright — a batch is not a way to buy more quota.
  if (batch.length > MAX_BATCH_SIZE) {
    return withRequestId(
      jsonResp(
        rpcError(null, -32600, `Batch too large: ${batch.length} requests (max ${MAX_BATCH_SIZE})`),
        400,
      ),
      requestId,
    );
  }

  const responses: unknown[] = [];

  for (const r of batch) {
    if (!isValidMessage(r)) {
      responses.push(rpcError((r as JsonRpcReq | null)?.id ?? null, -32600, "Invalid Request"));
      continue;
    }
    const isNotification = r.id === undefined || r.id === null;

    const limited = await throttle(auth, r);
    if (limited) {
      if (!isNotification) responses.push(limited);
      continue;
    }

    const out = await handleRpc(r, auth, source, request, sessionId);
    if (!isNotification) responses.push(out);
  }

  if (responses.length === 0) {
    return withRequestId(new Response(null, { status: 202, headers: CORS }), requestId);
  }

  const payload = isBatch ? responses : (responses[0] ?? null);

  // Preserve HTTP 429 for the common single-request throttle/quota case so clients
  // can back off. Batches always use 200 with per-item JSON-RPC errors.
  const status = !isBatch && isThrottleError(payload) ? 429 : 200;
  return withRequestId(wantsSse ? sseStream(payload) : jsonResp(payload, status), requestId);
}

function isThrottleError(payload: unknown): boolean {
  const code = (payload as { error?: { code?: number } } | null)?.error?.code;
  return code === -32003 || code === -32004;
}
