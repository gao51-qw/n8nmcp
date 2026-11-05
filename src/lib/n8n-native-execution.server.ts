// Workflow execution through n8n's instance-level MCP server.
//
// Native `execute_workflow` starts a run and returns its execution id at once;
// the result is read back with `get_workflow_execution`. Unlike the webhook
// path, `manual` mode runs the current version of an inactive draft, so a
// deployment smoke test does not need the workflow to be live first.
// The workflow must have "Available in MCP" switched on in n8n.
import type { N8nInstance } from "@/lib/mcp.server";
import { NativeMcpClient, type NativeMcpClientOptions } from "@/lib/n8n-native-mcp.server";
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

export async function runViaNativeMcp(
  client: Pick<NativeMcpClient, "callTool">,
  input: NativeRunInput,
  poll: PollOptions = {},
): Promise<NativeRunResult> {
  const trigger = findWebhookTrigger(input.workflow);
  const args: Record<string, unknown> = { workflowId: input.workflowId, executionMode: input.mode };
  if (trigger && input.data && Object.keys(input.data).length > 0) {
    args.triggerNodeName = trigger.nodeName;
    args.inputs = {
      type: "webhook",
      webhookData: { method: trigger.httpMethod, body: input.data },
    };
  }

  const started = await client.callTool("execute_workflow", args);
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
  // The run has started: from here on, failures only mean the result is
  // unknown. Never report "not started", or a caller could run it twice.
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(intervalMs);
    let result: unknown;
    try {
      result = await client.callTool(
        "get_workflow_execution",
        { workflowId: input.workflowId, executionId, includeData: true },
        { idempotent: true },
      );
    } catch {
      continue;
    }
    const record = isRecord(result) ? result : {};
    const meta = isRecord(record.execution) ? record.execution : {};
    execution = summarizeExecution({ ...meta, id: meta.id ?? executionId, data: record.data });
    if (execution.finished) break;
  }
  return { started: true, executionId, execution };
}
