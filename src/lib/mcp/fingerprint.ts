// Deterministic serialization and workflow fingerprints (confirmation scopes,
// preview staleness and rollback concurrency checks).
import { createHash } from "node:crypto";
import type { WorkflowLike } from "@/lib/workflow-agent";

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

/** Editable content only (name, nodes, connections, settings). */
export function workflowContentFingerprint(workflow: WorkflowLike): string {
  return createHash("sha256")
    .update(
      stableStringify({
        name: workflow.name ?? null,
        nodes: workflow.nodes ?? [],
        connections: workflow.connections ?? {},
        settings: workflow.settings ?? {},
      }),
    )
    .digest("hex");
}

/** Editable content plus versionId: the preview baseline for partial updates. */
export function workflowFingerprint(workflow: WorkflowLike): string {
  return createHash("sha256")
    .update(
      stableStringify({
        name: workflow.name ?? null,
        nodes: workflow.nodes ?? [],
        connections: workflow.connections ?? {},
        settings: workflow.settings ?? {},
        versionId: workflow.versionId ?? null,
      }),
    )
    .digest("hex");
}
