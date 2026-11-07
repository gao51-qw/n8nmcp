// Fail-closed argument parsers and small value helpers for MCP tools.
import { requireOperations } from "@/lib/workflow-agent";

export function asObj(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : {};
}
export function strId(v: unknown): string | undefined {
  return v == null ? undefined : String(v);
}
export function idOf(v: unknown): string | undefined {
  const id = asObj(v).id;
  return id == null ? undefined : String(id);
}
export function requireNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${field} (string) is required`);
  }
  return value;
}

export function optionalNumberArray(value: unknown, field: string): number[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  if (!value.every((item) => Number.isInteger(item) && item >= 0)) {
    throw new Error(`${field} must contain only non-negative integers`);
  }
  return value as number[];
}

export function requireObject(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${field} (object) is required`);
  }
  return value as Record<string, unknown>;
}

export function optionalObject(value: unknown, field: string): Record<string, unknown> | undefined {
  return value === undefined ? undefined : requireObject(value, field);
}

export function requireEnumString<T extends string>(
  value: unknown,
  field: string,
  allowed: readonly T[],
): T {
  const parsed = requireNonEmptyString(value, field);
  if (!allowed.includes(parsed as T)) {
    throw new Error(`${field} must be one of: ${allowed.join(", ")}`);
  }
  return parsed as T;
}

export function optionalBoolean(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new Error(`${field} must be a boolean`);
  return value;
}

export function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

export function optionalNumber(value: unknown, field: string): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${field} must be a finite number`);
  }
  return value;
}

export function validateConfirmationFields(args: Record<string, unknown>): void {
  optionalBoolean(args.confirm, "confirm");
  if (args.confirmationToken !== undefined) {
    requireNonEmptyString(args.confirmationToken, "confirmationToken");
  }
}

export function parsePreviewWorkflowDiffArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  optionalObject(args.policy, "policy");
  return {
    ...args,
    workflowId: requireNonEmptyString(args.workflowId, "workflowId"),
    operations: requireOperations(args.operations),
  };
}

export function parseUpdatePartialWorkflowArgs(
  args: Record<string, unknown>,
): Record<string, unknown> {
  optionalObject(args.policy, "policy");
  validateConfirmationFields(args);
  return {
    ...args,
    workflowId: requireNonEmptyString(args.workflowId, "workflowId"),
    operations: requireOperations(args.operations),
    sourcePreviewCallId: requireNonEmptyString(args.sourcePreviewCallId, "sourcePreviewCallId"),
    sourcePreviewOperationIndexes: optionalNumberArray(
      args.sourcePreviewOperationIndexes,
      "sourcePreviewOperationIndexes",
    ),
  };
}
