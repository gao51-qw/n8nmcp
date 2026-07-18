import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { WorkflowOperation } from "@/lib/workflow-agent";

export const WORKFLOW_PREVIEW_TTL_MS = 30 * 60_000;

export type TrustedPreviewRow = {
  id: string;
  user_id: string;
  tool_name: string | null;
  status: string;
  created_at: string;
  workflow_id: string | null;
  session_id?: string | null;
  metadata: unknown;
};

export type TrustedWorkflowPreview = {
  workflowId: string;
  operations: WorkflowOperation[];
  baseVersionId?: string;
  baseFingerprint?: string;
};

type TrustedPreviewInput = {
  preview: TrustedPreviewRow | null;
  userId: string;
  workflowId: string;
  operations: unknown[];
  operationIndexes?: number[];
  sessionId?: string;
  now?: Date;
};

export async function loadTrustedWorkflowPreview(
  userId: string,
  previewCallId: string,
): Promise<TrustedPreviewRow | null> {
  const { data, error } = await supabaseAdmin
    .from("mcp_call_logs")
    .select("id,user_id,tool_name,status,created_at,workflow_id,session_id,metadata")
    .eq("id", previewCallId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error("Failed to load trusted workflow preview");
  }

  return data as TrustedPreviewRow | null;
}

export function assertTrustedWorkflowPreview(input: TrustedPreviewInput): TrustedWorkflowPreview {
  const { preview, userId, workflowId, operationIndexes } = input;
  if (
    !preview ||
    preview.user_id !== userId ||
    preview.tool_name !== "preview_workflow_diff" ||
    preview.status !== "ok"
  ) {
    throw new Error("Trusted workflow preview not found");
  }
  if (input.sessionId && preview.session_id && preview.session_id !== input.sessionId) {
    throw new Error("Workflow preview session does not match the current session");
  }

  const createdAt = new Date(preview.created_at).getTime();
  const age = (input.now ?? new Date()).getTime() - createdAt;
  if (!Number.isFinite(createdAt) || age < -60_000 || age > WORKFLOW_PREVIEW_TTL_MS) {
    throw new Error("Workflow preview is stale");
  }

  const metadata = asRecord(preview.metadata);
  const trustedWorkflowId = stringValue(metadata.workflowId ?? preview.workflow_id);
  if (
    trustedWorkflowId !== workflowId ||
    (preview.workflow_id !== null && preview.workflow_id !== trustedWorkflowId)
  ) {
    throw new Error("Workflow preview scope does not match the requested workflow");
  }

  const storedOperations = Array.isArray(metadata.operations) ? metadata.operations : [];
  const trustedOperations = operationIndexes
    ? selectOperations(storedOperations, operationIndexes)
    : requireMatchingOperations(storedOperations, input.operations);

  return {
    workflowId,
    operations: trustedOperations as WorkflowOperation[],
    ...(stringValue(metadata.baseVersionId)
      ? { baseVersionId: stringValue(metadata.baseVersionId) as string }
      : {}),
    ...(stringValue(metadata.baseFingerprint)
      ? { baseFingerprint: stringValue(metadata.baseFingerprint) as string }
      : {}),
  };
}

function selectOperations(storedOperations: unknown[], indexes: number[]): unknown[] {
  if (indexes.length === 0) {
    throw new Error("Workflow preview selection requires at least one operation");
  }
  if (indexes.some((index) => !Number.isInteger(index))) {
    throw new Error("Workflow preview operation indexes must be integers");
  }
  if (new Set(indexes).size !== indexes.length) {
    throw new Error("Workflow preview operation indexes must be unique");
  }
  if (indexes.some((index) => index < 0 || index >= storedOperations.length)) {
    throw new Error("Workflow preview operation index is outside the allowed range");
  }
  return indexes.map((index) => storedOperations[index]);
}

function requireMatchingOperations(stored: unknown[], requested: unknown[]): unknown[] {
  if (stableStringify(stored) !== stableStringify(requested)) {
    throw new Error("Workflow operations do not match the trusted preview");
  }
  return stored;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}
