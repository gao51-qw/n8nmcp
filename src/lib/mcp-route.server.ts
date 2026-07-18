// MCP Streamable HTTP gateway endpoint handler.
// Spec: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
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

const ROBOTS_NOINDEX = "noindex,nofollow";
const CLIENT_CAPABILITIES_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const ELICITATION_RESPONSE_TTL_MS = 5 * 60_000;
const clientCapabilitySessions = new Map<
  string,
  { capabilities: ToolContext["clientCapabilities"]; expiresAt: number }
>();
const elicitationResponses = new Map<
  string,
  { response: Record<string, unknown>; expiresAt: number }
>();

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

function storeElicitationResponse(elicitationId: string, response: Record<string, unknown>) {
  elicitationResponses.set(elicitationId, {
    response,
    expiresAt: Date.now() + ELICITATION_RESPONSE_TTL_MS,
  });
}

function popElicitationResponse(elicitationId: string): Record<string, unknown> | null {
  const entry = elicitationResponses.get(elicitationId);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    elicitationResponses.delete(elicitationId);
    return null;
  }
  elicitationResponses.delete(elicitationId);
  return entry.response;
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
  clientCapabilitySessions.set(key, {
    capabilities,
    expiresAt: Date.now() + CLIENT_CAPABILITIES_SESSION_TTL_MS,
  });
}

function loadSessionCapabilities(
  userId: string,
  sessionId: string | null,
  request: Request,
): ToolContext["clientCapabilities"] | null {
  const key = buildSessionKey(userId, request, sessionId);
  const record = clientCapabilitySessions.get(key);
  if (!record) return null;
  if (record.expiresAt < Date.now()) {
    clientCapabilitySessions.delete(key);
    return null;
  }
  return record.capabilities;
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

  const directElicitationResponse = asRecord(requestParams).elicitationResponse;
  if (directElicitationResponse && typeof directElicitationResponse === "object") {
    const pendingId = String(asRecord(directElicitationResponse).elicitationId || "").trim();
    if (pendingId) {
      const storedResponse = popElicitationResponse(pendingId);
      if (storedResponse) {
        return {
          clientCapabilities,
          requestElicitation: async () => storedResponse,
        };
      }
      return {
        clientCapabilities,
        requestElicitation: async () => {
          throw new Error(
            `Missing elicitation response for ${pendingId}. Re-run notifications/elicitation/complete.`,
          );
        },
      };
    }
  }

  const requestElicitation =
    clientCapabilities?.elicitation === true
      ? async (elicitationRequest: ElicitationRequest) => {
          if (directElicitationResponse && typeof directElicitationResponse === "object") {
            return directElicitationResponse as Record<string, unknown>;
          }

          const elicitationId = buildElicitationId();
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
): Promise<unknown> {
  if (!ctx) return rpcError(req.id, -32001, "Unauthorized");

  switch (req.method) {
    case "initialize":
      if (req.params) {
        const capabilities = parseClientCapabilities(asRecord(req.params));
        storeSessionCapabilities(ctx.user_id, sessionId, request, capabilities);
      }
      return rpcResult(req.id, {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: {
          name: "n8n-mcp-gateway",
          version: "0.2.0",
          notes: isUpstreamConfigured()
            ? "local management + self-hosted n8n-knowledge-mcp upstream"
            : "local-only (upstream knowledge base not configured)",
        },
      });

    case "ping":
    case "notifications/initialized":
      return rpcResult(req.id, {});

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
      });
      return rpcResult(req.id, { tools });
    }

    case "notifications/elicitation/complete": {
      const params = asRecord(req.params);
      const elicitationId = String(params.elicitationId ?? "").trim();
      const completion = asRecord(params.action);
      if (!elicitationId) {
        return rpcError(req.id, -32602, "Missing elicitationId");
      }
      if (!completion || Object.keys(completion).length === 0) {
        return rpcError(req.id, -32602, "Missing elicitation response payload");
      }
      storeElicitationResponse(elicitationId, completion);
      return rpcResult(req.id, { ok: true, elicitationId });
    }

    case "tools/call": {
      const params = req.params ?? {};
      const name = String(params.name ?? "");
      const args = (params.arguments ?? {}) as Record<string, unknown>;
      const started = Date.now();
      const toolContext = resolveToolContext(ctx.user_id, request, sessionId, params);
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
          });
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

  let body: JsonRpcReq | JsonRpcReq[];
  try {
    body = await request.json();
  } catch {
    return withRequestId(jsonResp(rpcError(null, -32700, "Parse error"), 400), requestId);
  }

  const wantsSse = (request.headers.get("accept") ?? "").includes("text/event-stream");
  const isBatch = Array.isArray(body);
  const batch: JsonRpcReq[] = Array.isArray(body) ? body : [body];

  if (batch.length === 0) {
    return withRequestId(
      jsonResp(rpcError(null, -32600, "Invalid Request: empty batch"), 400),
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
    if (!r || r.jsonrpc !== "2.0" || typeof r.method !== "string") {
      responses.push(rpcError(r?.id ?? null, -32600, "Invalid Request"));
      continue;
    }
    const isNotification = r.id === undefined || r.id === null;

    // Throttle/quota are enforced PER RPC inside the batch, so N tool calls cost
    // N tokens — not one decision amortized across the whole array. The daily
    // quota is re-read before each billable call; recordCall() in handleRpc has
    // already incremented usage for any prior call in this sequential loop.
    if (!(await checkShortWindowQuota(auth.user_id))) {
      await recordCall({
        user_id: auth.user_id,
        tool_name: null,
        status: "rate_limited",
        latency_ms: 0,
        error_message: "short-window throttle",
      });
      const err = rpcError(r.id ?? null, -32003, "Rate limit exceeded (60 req / 10s)");
      if (!isNotification) responses.push(err);
      continue;
    }

    if (isBillableMethod(r.method)) {
      const quota = await checkDailyQuota(auth);
      if (!quota.ok) {
        await recordCall({
          user_id: auth.user_id,
          tool_name: null,
          status: "rate_limited",
          latency_ms: 0,
          error_message: `daily quota exceeded (${quota.used}/${quota.limit})`,
        });
        const err = rpcError(
          r.id ?? null,
          -32004,
          `Daily quota exceeded (${quota.used}/${quota.limit})`,
        );
        if (!isNotification) responses.push(err);
        continue;
      }
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
