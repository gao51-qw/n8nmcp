import type { WorkflowLike } from "./workflow-agent";

/**
 * Running workflows through the n8n Public API.
 *
 * The Public API (`/api/v1`) exposes no endpoint that starts an execution:
 * `/workflows/{id}` only supports GET/PUT/DELETE plus activate/deactivate.
 * The only way to run a workflow from outside the editor is to hit the
 * production webhook URL of a Webhook trigger node, which n8n registers while
 * the workflow is active. Results are then read back from `/executions`.
 */

export type N8nRequest = (path: string, init?: RequestInit) => Promise<unknown>;

export type WebhookTrigger = {
  nodeName: string;
  path: string;
  httpMethod: string;
};

export type WebhookTriggerResult = {
  url: string;
  method: string;
  status: number;
  body: unknown;
};

export type ExecutionSummary = {
  id: string | null;
  status: string | null;
  finished: boolean;
  error: string | null;
  lastNodeExecuted: string | null;
  output: Record<string, unknown> | null;
};

const WEBHOOK_NODE_TYPE = "n8n-nodes-base.webhook";
const TERMINAL_STATUSES = new Set(["success", "error", "crashed", "canceled"]);
const WEBHOOK_TIMEOUT_MS = 20_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** First enabled Webhook trigger node of the workflow, or null when it has none. */
export function findWebhookTrigger(workflow: WorkflowLike): WebhookTrigger | null {
  for (const node of workflow.nodes ?? []) {
    if (!isRecord(node) || node.type !== WEBHOOK_NODE_TYPE || node.disabled === true) continue;
    const parameters = isRecord(node.parameters) ? node.parameters : {};
    const path = nonEmptyString(parameters.path) ?? nonEmptyString(node.webhookId);
    if (!path) continue;
    return {
      nodeName: nonEmptyString(node.name) ?? "Webhook",
      path: path.replace(/^\/+/, ""),
      httpMethod: (nonEmptyString(parameters.httpMethod) ?? "GET").toUpperCase(),
    };
  }
  return null;
}

export function buildProductionWebhookUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/webhook/${path.replace(/^\/+/, "")}`;
}

function describeWorkflow(workflow: WorkflowLike): string {
  return workflow.id == null ? "Workflow" : `Workflow ${String(workflow.id)}`;
}

/**
 * Trigger a workflow through its production webhook.
 *
 * Fails closed when the workflow is inactive (n8n only serves production
 * webhooks for active workflows) or has no Webhook trigger, with messages that
 * tell the agent what it can do instead. The request goes through the SSRF
 * guard and never carries the n8n API key: the webhook belongs to user-defined
 * workflow logic, not to the Public API.
 */
export function resolveWebhookTrigger(
  workflow: WorkflowLike,
  options: { assumeActive?: boolean } = {},
): WebhookTrigger {
  if (!options.assumeActive && workflow.active !== true) {
    throw new Error(
      `${describeWorkflow(workflow)} is not active. The n8n Public API has no execution endpoint; ` +
        "a workflow can only be triggered through the production webhook URL that n8n registers " +
        "while the workflow is active. Activate it first (activate_workflow) or run it from the n8n editor.",
    );
  }
  const trigger = findWebhookTrigger(workflow);
  if (!trigger) {
    throw new Error(
      `${describeWorkflow(workflow)} has no enabled Webhook trigger node with a path. The n8n Public API ` +
        "has no execution endpoint, so only webhook-triggered workflows can be run through MCP. " +
        "Workflows started by schedule, manual, or app triggers run on their own; inspect them with list_executions.",
    );
  }
  return trigger;
}

export async function triggerWorkflowWebhook(
  baseUrl: string,
  workflow: WorkflowLike,
  data: Record<string, unknown> = {},
  options: { assumeActive?: boolean } = {},
): Promise<WebhookTriggerResult> {
  const trigger = resolveWebhookTrigger(workflow, options);
  let url = buildProductionWebhookUrl(baseUrl, trigger.path);
  const init: RequestInit = {
    method: trigger.httpMethod,
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
  };
  if (trigger.httpMethod === "GET" || trigger.httpMethod === "HEAD") {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      query.set(key, typeof value === "string" ? value : JSON.stringify(value));
    }
    const qs = query.toString();
    if (qs) url += `?${qs}`;
  } else {
    init.headers = { ...init.headers, "Content-Type": "application/json" };
    init.body = JSON.stringify(data);
  }

  const { safeFetchPublicUrl } = await import("./ssrf-guard.server");
  const res = await safeFetchPublicUrl(url, init);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Webhook responses are user-defined; keep non-JSON bodies as text.
  }
  if (!res.ok) {
    throw new Error(
      `Webhook trigger ${trigger.httpMethod} ${url} failed with status ${res.status}` +
        (res.status === 404
          ? " (n8n returned 404: the production webhook is not registered; make sure the workflow is active)"
          : ""),
    );
  }
  return { url, method: trigger.httpMethod, status: res.status, body };
}

function firstOutputItem(execution: Record<string, unknown>): {
  lastNodeExecuted: string | null;
  output: Record<string, unknown> | null;
} {
  const data = isRecord(execution.data) ? execution.data : {};
  const resultData = isRecord(data.resultData) ? data.resultData : {};
  const lastNodeExecuted = nonEmptyString(resultData.lastNodeExecuted);
  if (!lastNodeExecuted) return { lastNodeExecuted: null, output: null };
  const runData = isRecord(resultData.runData) ? resultData.runData : {};
  const runs = runData[lastNodeExecuted];
  const lastRun = Array.isArray(runs) ? runs[runs.length - 1] : undefined;
  const main = isRecord(lastRun) && isRecord(lastRun.data) ? lastRun.data.main : undefined;
  const branch = Array.isArray(main) ? main[0] : undefined;
  const item = Array.isArray(branch) ? branch[0] : undefined;
  if (!isRecord(item)) return { lastNodeExecuted, output: null };
  return { lastNodeExecuted, output: isRecord(item.json) ? item.json : item };
}

/** Normalize an n8n execution record (as returned with includeData=true). */
export function summarizeExecution(raw: unknown): ExecutionSummary {
  const execution = isRecord(raw) ? raw : {};
  const status = nonEmptyString(execution.status);
  const data = isRecord(execution.data) ? execution.data : {};
  const resultData = isRecord(data.resultData) ? data.resultData : {};
  const rawError = resultData.error;
  const error =
    rawError == null
      ? null
      : isRecord(rawError)
        ? (nonEmptyString(rawError.message) ?? JSON.stringify(rawError))
        : String(rawError);
  const { lastNodeExecuted, output } = firstOutputItem(execution);
  return {
    id: execution.id == null ? null : String(execution.id),
    status,
    finished: execution.finished === true || (status !== null && TERMINAL_STATUSES.has(status)),
    error: error ?? (status === "error" || status === "crashed" ? `Execution ${status}` : null),
    lastNodeExecuted,
    output,
  };
}

function executionsPath(workflowId: string, includeData: boolean): string {
  const qs = new URLSearchParams({ workflowId, limit: "1" });
  if (includeData) qs.set("includeData", "true");
  return `/api/v1/executions?${qs}`;
}

function firstExecution(body: unknown): Record<string, unknown> | null {
  const list = isRecord(body) && Array.isArray(body.data) ? body.data : [];
  return isRecord(list[0]) ? list[0] : null;
}

/** Id of the most recent execution of the workflow, so a later run can be told apart from it. */
export async function latestExecutionId(
  request: N8nRequest,
  workflowId: string,
): Promise<string | null> {
  const latest = firstExecution(await request(executionsPath(workflowId, false)));
  return latest?.id == null ? null : String(latest.id);
}

/**
 * Poll `/executions` until a new, finished execution of the workflow shows up.
 * Returns the latest matching execution (possibly unfinished) once the attempts
 * are exhausted, or null when nothing new was recorded.
 */
export async function waitForNewExecution(
  request: N8nRequest,
  workflowId: string,
  options: {
    excludeId?: string | null;
    attempts?: number;
    intervalMs?: number;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<ExecutionSummary | null> {
  const attempts = Math.max(1, options.attempts ?? 10);
  const intervalMs = options.intervalMs ?? 1_000;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  let latest: ExecutionSummary | null = null;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(intervalMs);
    const execution = firstExecution(await request(executionsPath(workflowId, true)));
    if (!execution) continue;
    const summary = summarizeExecution(execution);
    if (options.excludeId && summary.id === options.excludeId) continue;
    latest = summary;
    if (summary.finished) return summary;
  }
  return latest;
}
