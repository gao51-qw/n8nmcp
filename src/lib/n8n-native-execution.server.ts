// Workflow execution through n8n's instance-level MCP server.
//
// Native `execute_workflow` starts a run and returns its execution id at once;
// the result is read back with `get_workflow_execution`. Unlike the webhook
// path, `manual` mode runs the current version of an inactive draft, so a
// deployment smoke test does not need the workflow to be live first.
// The workflow must have "Available in MCP" switched on in n8n.
import type { N8nInstance } from "@/lib/mcp.server";
import {
  NativeMcpClient,
  NativeMcpError,
  type NativeMcpClientOptions,
} from "@/lib/n8n-native-mcp.server";
import {
  findWebhookTrigger,
  summarizeExecution,
  type ExecutionSummary,
} from "@/lib/n8n-execution.server";
import type { WorkflowLike } from "@/lib/workflow-agent";

export type ExecutionSource = "native_mcp" | "webhook";

export type NativeRunInput = {
  workflowId: string;
  workflow: WorkflowLike;
  mode: "manual" | "production";
  /** Sent as the Webhook trigger's request body when the workflow has one. */
  data?: Record<string, unknown>;
};

export type NativeRunResult =
  | { started: true; executionId: string; execution: ExecutionSummary | null }
  | { started: false; error: string };

type PollOptions = {
  attempts?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether the instance has a stored MCP token whose server offers `tool`. */
export function nativeToolAvailable(inst: N8nInstance | null | undefined, tool: string): boolean {
  return !!inst?.native && inst.native.tools.includes(tool);
}

export function nativeClientFor(
  inst: N8nInstance,
  overrides: Partial<NativeMcpClientOptions> = {},
): NativeMcpClient {
  if (!inst.native) throw new Error("Instance has no instance-level MCP token");
  return new NativeMcpClient({ baseUrl: inst.base_url, token: inst.native.token, ...overrides });
}

function isUnknownTool(error: unknown, tool: string): boolean {
  return (
    error instanceof NativeMcpError &&
    error.message.includes(tool) &&
    /not found|unknown tool/i.test(error.message)
  );
}

/**
 * n8n 2.39+ takes webhook inputs as `{ webhookData }` (a strict union that
 * rejects any other key); 2.27–2.33 used `{ type: "webhook", webhookData }`.
 * Send the current shape and, when n8n rejects the arguments, retry once with
 * the legacy shape. An argument validation error never starts a run, so the
 * retry cannot execute the workflow twice.
 */
async function startNativeRun(
  client: Pick<NativeMcpClient, "callTool">,
  args: Record<string, unknown>,
): Promise<unknown> {
  try {
    return await client.callTool("execute_workflow", args);
  } catch (error) {
    // Newer servers answer with an isError result ("Input validation error:
    // …"), older ones with a JSON-RPC -32602 (Invalid params) error.
    const rejectedInputs =
      isRecord(args.inputs) &&
      error instanceof NativeMcpError &&
      ((error.kind === "tool" && /input validation error/i.test(error.message)) ||
        (error.kind === "protocol" && /error -32602\b/.test(error.message))) &&
      /\binputs\b/.test(error.message);
    if (!rejectedInputs) throw error;
    return client.callTool("execute_workflow", {
      ...args,
      inputs: { type: "webhook", ...(args.inputs as Record<string, unknown>) },
    });
  }
}

export async function runViaNativeMcp(
  client: Pick<NativeMcpClient, "callTool">,
  input: NativeRunInput,
  poll: PollOptions = {},
): Promise<NativeRunResult> {
  const trigger = findWebhookTrigger(input.workflow);
  const args: Record<string, unknown> = { workflowId: input.workflowId, executionMode: input.mode };
  // n8n's execute_workflow requires triggerNodeName + inputs for webhook
  // triggers ("Provide triggerNodeName and inputs to execute this workflow"),
  // with or without a payload. Schedule and manual triggers take neither.
  if (trigger) {
    args.triggerNodeName = trigger.nodeName;
    args.inputs = { webhookData: { method: trigger.httpMethod, body: input.data ?? {} } };
  }

  const started = await startNativeRun(client, args);
  const startedRecord = isRecord(started) ? started : {};
  const executionId = startedRecord.executionId == null ? null : String(startedRecord.executionId);
  if (!executionId || startedRecord.status === "error") {
    const error = startedRecord.error;
    return {
      started: false,
      error:
        typeof error === "string" && error
          ? error
          : isRecord(error) && typeof error.message === "string"
            ? error.message
            : "n8n did not start the execution",
    };
  }

  const attempts = Math.max(1, poll.attempts ?? 15);
  const intervalMs = poll.intervalMs ?? 1_000;
  const sleep = poll.sleep ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));
  let execution: ExecutionSummary | null = null;
  // n8n 2.39+ calls the lookup get_workflow_execution; 2.27–2.33 call the same
  // tool (same arguments and result) get_execution.
  let lookupTool = "get_workflow_execution";
  const lookup = () =>
    client.callTool(
      lookupTool,
      { workflowId: input.workflowId, executionId, includeData: true },
      { idempotent: true },
    );
  // The run has started: from here on, failures only mean the result is
  // unknown. Never report "not started", or a caller could run it twice.
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(intervalMs);
    let result: unknown;
    try {
      result = await lookup();
    } catch (error) {
      if (lookupTool !== "get_workflow_execution" || !isUnknownTool(error, lookupTool)) continue;
      lookupTool = "get_execution";
      try {
        result = await lookup();
      } catch {
        continue;
      }
    }
    const record = isRecord(result) ? result : {};
    const meta = isRecord(record.execution) ? record.execution : {};
    execution = summarizeExecution({ ...meta, id: meta.id ?? executionId, data: record.data });
    if (execution.finished) break;
  }
  return { started: true, executionId, execution };
}
