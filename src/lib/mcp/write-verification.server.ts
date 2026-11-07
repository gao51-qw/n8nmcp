// Post-write detection of concurrent n8n workflow edits (server-only).
//
// The n8n Public API has no conditional update: PUT /api/v1/workflows/{id}
// accepts only name/nodes/connections/settings (+ staticData), treats
// versionId/updatedAt as read-only, and honours no If-Match header. The
// instance-level MCP `update_workflow` tool has no expected-version argument
// either. Our writers (rollback, update_partial_workflow, update_workflow and
// the patch tools) therefore read the workflow, check it, and PUT — and an
// edit saved in n8n between that last read and the PUT is overwritten.
//
// This module cannot close that window; it turns "silently overwritten" into
// "detected and flagged" as far as the API allows. After every PUT it re-reads
// the workflow exactly once and classifies the write:
//
//   concurrent_write_after (provable)
//     The re-read shows a different saved state than the PUT response: n8n
//     assigns a new versionId on every save, so a re-read versionId that
//     differs from the PUT response's versionId proves a save landed after
//     ours (and that our change may already be overwritten). Fallbacks when
//     n8n omits versionId: updatedAt, then the editable content.
//
//   concurrent_write_suspected (heuristic)
//     Evidence that someone saved between our last read and our PUT, or while
//     n8n was building the PUT response. Our PUT replaces the whole editable
//     body and resets versionId/updatedAt, so an edit it overwrote leaves no
//     trace the Public API exposes (there is no version-history list endpoint;
//     GET /api/v1/workflows/{id}/{versionId} needs a versionId we never saw).
//     In particular, "PUT updatedAt minus pre-read updatedAt" cannot reveal an
//     intervening save: the intervening timestamp is overwritten by ours. What
//     remains observable:
//       - response_content: the PUT response's name, node names/types or
//         connection edges differ from what we sent. n8n saves, then reads the
//         row back for the response, so a save between the two shows here.
//         n8n-side normalisation could also cause it, hence "suspected".
//       - preserved_fields: a field our PUT does not send (description,
//         pinData) changed between the pre-read and the PUT response to a new
//         non-empty value. n8n keeps unsent fields, so only another writer can
//         set them; the writer may not have touched what we overwrote, hence
//         "suspected". A field n8n clears on its own never counts.
//
//   unverified
//     The verification read failed (or the workflow carries none of the
//     signals above). Never fatal: the write already succeeded.
//
//   clean
//     None of the above.
//
// Limits: an edit that landed between our read and our PUT and touched only
// name/nodes/connections/settings is overwritten without any observable trace
// unless n8n's version history is consulted (the instance-level MCP
// get_workflow_history tool, n8n 2.29+, would show it but costs a second call
// and an MCP token). Cost: exactly one extra GET per write.
import * as Sentry from "@sentry/nextjs";
import { log } from "@/lib/logger.server";
import type { WorkflowLike } from "@/lib/workflow-agent";
import { CONCURRENT_WRITE_DETECTED_MESSAGE } from "@/lib/workflow-agent/action-conflict";
import { asObj, strId } from "./args";
import { stableStringify } from "./fingerprint";
import { n8n } from "./n8n-client.server";
import type { N8nInstance } from "./types";

export type ConcurrencyAfterWriteStatus =
  "clean" | "concurrent_write_after" | "concurrent_write_suspected" | "unverified";

export type ConcurrencyAfterWriteSignal =
  | "versionId"
  | "updatedAt"
  | "content"
  | "response_content"
  | "preserved_fields"
  | "reread_failed"
  | "no_version_signal";

/** The verification result. Identifiers and field names only, never workflow content. */
export type ConcurrencyAfterWrite = {
  status: ConcurrencyAfterWriteStatus;
  /** The signal that decided the status (null when clean). */
  signal: ConcurrencyAfterWriteSignal | null;
  /** Every signal that fired, primary first. */
  signals: ConcurrencyAfterWriteSignal[];
  baseVersionId: string | null;
  writtenVersionId: string | null;
  rereadVersionId: string | null;
  baseUpdatedAt: string | null;
  writtenUpdatedAt: string | null;
  rereadUpdatedAt: string | null;
  /** Unsent fields that changed between the pre-read and the PUT response. */
  driftedFields?: string[];
};

export const SENTRY_CONCURRENT_WRITE_MESSAGE = "n8n workflow concurrent write detected";

/** Fields the PUT never sends; n8n keeps their stored value on update. */
const PRESERVED_FIELDS = ["description", "pinData"] as const;

/**
 * Non-enumerable key on tool results that carries the verification, so the
 * audit hook can record it without it leaking into the serialized output.
 */
export const CONCURRENCY_AFTER_WRITE = Symbol("concurrencyAfterWrite");

/** Keys added to a tool result when a concurrent write is flagged. */
const FLAG_OUTPUT_KEYS = [
  "concurrent_write_detected",
  "concurrent_write_message",
  "concurrency_after_write",
] as const;

export function isConcurrentWriteFlagged(concurrency: ConcurrencyAfterWrite | null | undefined) {
  return (
    concurrency?.status === "concurrent_write_after" ||
    concurrency?.status === "concurrent_write_suspected"
  );
}

/**
 * Classify one completed write. `base` is the last read before the PUT,
 * `sent` the PUT body, `written` the PUT response, and `reread` the
 * verification read (`{ ok: false }` when it failed).
 */
export function assessWriteConcurrency(input: {
  base: unknown;
  sent: unknown;
  written: unknown;
  reread: { ok: true; workflow: unknown } | { ok: false };
}): ConcurrencyAfterWrite {
  const base = asObj(input.base);
  const written = asObj(input.written);
  const reread = input.reread.ok ? asObj(input.reread.workflow) : null;

  const signals: ConcurrencyAfterWriteSignal[] = [];
  let after: ConcurrencyAfterWriteSignal | null = null;
  let noAnchor = false;
  if (reread) {
    after = writtenThenChanged(written, reread);
    if (after === "no_version_signal") {
      noAnchor = true;
      after = null;
    }
  }
  if (after) signals.push(after);

  const sentShape = contentShape(input.sent);
  const writtenShape = contentShape(written);
  if (sentShape && writtenShape && sentShape !== writtenShape) signals.push("response_content");
  const driftedFields = PRESERVED_FIELDS.filter((field) => {
    if (!(field in base) || !(field in written)) return false;
    const now = written[field];
    if (isEmptyValue(now)) return false;
    return stableStringify(base[field] ?? null) !== stableStringify(now);
  });
  if (driftedFields.length > 0) signals.push("preserved_fields");

  if (!reread) signals.push("reread_failed");
  else if (noAnchor) signals.push("no_version_signal");

  const status: ConcurrencyAfterWriteStatus = after
    ? "concurrent_write_after"
    : signals.includes("response_content") || signals.includes("preserved_fields")
      ? "concurrent_write_suspected"
      : signals.length > 0
        ? "unverified"
        : "clean";

  return {
    status,
    signal: signals[0] ?? null,
    signals,
    baseVersionId: strId(base.versionId) || null,
    writtenVersionId: strId(written.versionId) || null,
    rereadVersionId: reread ? strId(reread.versionId) || null : null,
    baseUpdatedAt: timestamp(base.updatedAt),
    writtenUpdatedAt: timestamp(written.updatedAt),
    rereadUpdatedAt: reread ? timestamp(reread.updatedAt) : null,
    ...(driftedFields.length > 0 ? { driftedFields: [...driftedFields] } : {}),
  };
}

/**
 * Provable post-write change: the strongest anchor present on both the PUT
 * response and the re-read decides. versionId changes on every save; when it
 * is missing, updatedAt (which n8n may also bump for non-content updates, still
 * a save after ours); last, the editable content.
 */
function writtenThenChanged(
  written: Record<string, unknown>,
  reread: Record<string, unknown>,
): ConcurrencyAfterWriteSignal | null {
  const writtenVersion = strId(written.versionId);
  const rereadVersion = strId(reread.versionId);
  if (writtenVersion && rereadVersion) {
    return writtenVersion === rereadVersion ? null : "versionId";
  }
  const writtenAt = timestamp(written.updatedAt);
  const rereadAt = timestamp(reread.updatedAt);
  if (writtenAt && rereadAt) return writtenAt === rereadAt ? null : "updatedAt";
  const writtenShape = contentShape(written);
  const rereadShape = contentShape(reread);
  if (writtenShape && rereadShape) return writtenShape === rereadShape ? null : "content";
  return "no_version_signal";
}

/**
 * A normalisation-tolerant projection of the editable content: the name, the
 * set of node (name, type) pairs and the set of connection edges. n8n may add
 * node ids, webhook ids or setting defaults on save, so parameters, positions
 * and settings are deliberately left out. Null when there are no nodes.
 */
function contentShape(value: unknown): string | null {
  const workflow = asObj(value) as WorkflowLike & Record<string, unknown>;
  if (!Array.isArray(workflow.nodes)) return null;
  const nodes = workflow.nodes
    .map((node) => {
      const record = asObj(node);
      return `${String(record.name ?? "")}\u0000${String(record.type ?? "")}`;
    })
    .sort();
  const edges: string[] = [];
  for (const [source, byType] of Object.entries(asObj(workflow.connections))) {
    for (const [type, outputs] of Object.entries(asObj(byType))) {
      if (!Array.isArray(outputs)) continue;
      outputs.forEach((targets, outputIndex) => {
        if (!Array.isArray(targets)) return;
        for (const target of targets) {
          const edge = asObj(target);
          edges.push(
            [
              source,
              type,
              outputIndex,
              String(edge.node ?? ""),
              String(edge.type ?? ""),
              String(edge.index ?? 0),
            ].join("\u0000"),
          );
        }
      });
    }
  }
  edges.sort();
  return stableStringify({
    name: typeof workflow.name === "string" ? workflow.name : null,
    nodes,
    edges,
  });
}

function timestamp(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return null;
}

function isEmptyValue(value: unknown): boolean {
  if (value == null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as object).length === 0;
  return false;
}

export type WriteVerificationContext = {
  tool: string;
  workflowId: string;
  instanceId: string;
};

/**
 * PUT the workflow, then verify it with exactly one GET. PUT failures
 * propagate (nothing was written); a failed verification read never does.
 */
export async function putWorkflowAndVerify(
  inst: N8nInstance,
  workflowId: string,
  payload: Record<string, unknown>,
  base: unknown,
  tool: string,
): Promise<{ written: unknown; concurrency: ConcurrencyAfterWrite }> {
  const path = `/api/v1/workflows/${encodeURIComponent(workflowId)}`;
  const written = await n8n(inst, path, { method: "PUT", body: JSON.stringify(payload) });
  const concurrency = await verifyWorkflowWrite(inst, workflowId, payload, base, written, tool);
  return { written, concurrency };
}

/** The verification half of putWorkflowAndVerify, for writers that PUT themselves. */
export async function verifyWorkflowWrite(
  inst: N8nInstance,
  workflowId: string,
  sent: unknown,
  base: unknown,
  written: unknown,
  tool: string,
): Promise<ConcurrencyAfterWrite> {
  const context: WriteVerificationContext = { tool, workflowId, instanceId: inst.id };
  let reread: { ok: true; workflow: unknown } | { ok: false };
  try {
    reread = {
      ok: true,
      workflow: await n8n(inst, `/api/v1/workflows/${encodeURIComponent(workflowId)}`),
    };
  } catch (error) {
    reread = { ok: false };
    log.warn("workflow.write_verification_failed", {
      tool: context.tool,
      workflow_id: context.workflowId,
      instance_id: context.instanceId,
      // n8n client errors carry only the HTTP status, never response bodies.
      err: error instanceof Error ? error.message : "unknown",
    });
  }
  const concurrency = assessWriteConcurrency({ base, sent, written, reread });
  reportConcurrentWrite(concurrency, context);
  return concurrency;
}

/** Structured warning plus a Sentry warning for a flagged write. Never throws. */
function reportConcurrentWrite(
  concurrency: ConcurrencyAfterWrite,
  context: WriteVerificationContext,
): void {
  if (!isConcurrentWriteFlagged(concurrency)) return;
  const fields = {
    tool: context.tool,
    workflow_id: context.workflowId,
    instance_id: context.instanceId,
    status: concurrency.status,
    signal: concurrency.signal,
    signals: concurrency.signals,
    written_version_id: concurrency.writtenVersionId,
    reread_version_id: concurrency.rereadVersionId,
  };
  try {
    log.warn("workflow.concurrent_write_detected", fields);
  } catch {
    // Logging must never fail the completed write.
  }
  try {
    sentryCaptureMessage()?.(SENTRY_CONCURRENT_WRITE_MESSAGE, {
      level: "warning",
      tags: {
        domain: "workflow-agent",
        tool: context.tool,
        concurrency_status: concurrency.status,
        concurrency_signal: concurrency.signal ?? "none",
      },
      extra: {
        workflowId: context.workflowId,
        instanceId: context.instanceId,
        signals: concurrency.signals,
      },
    });
  } catch {
    // Sentry unavailable: the structured log above is the record.
  }
}

type SentryCaptureMessage = (
  message: string,
  context: { level: "warning"; tags: Record<string, string>; extra: Record<string, unknown> },
) => string;

/**
 * Sentry.captureMessage. The server and edge builds of @sentry/nextjs export
 * it, but its published type surface omits it (the client/server re-exports
 * are ambiguous), so it is looked up at runtime with a narrow signature.
 */
function sentryCaptureMessage(): SentryCaptureMessage | null {
  const capture = (Sentry as unknown as Record<string, unknown>).captureMessage;
  return typeof capture === "function" ? (capture as SentryCaptureMessage) : null;
}

/** The audit-row form of a verification (tool_params.concurrencyAfterWrite). */
export function concurrencyAuditParams(
  concurrency: ConcurrencyAfterWrite,
): Record<string, unknown> {
  return { ...concurrency };
}

/**
 * Attach a verification to a tool result: always as the non-enumerable
 * CONCURRENCY_AFTER_WRITE key (for the audit hook), and, when a concurrent
 * write was flagged, as the documented output fields with the fixed message.
 * Mutates and returns `result`.
 */
export function attachConcurrencyResult<T extends object>(
  result: T,
  concurrency: ConcurrencyAfterWrite,
): T {
  Object.defineProperty(result, CONCURRENCY_AFTER_WRITE, { value: concurrency });
  if (isConcurrentWriteFlagged(concurrency)) {
    Object.assign(result, concurrencyOutputFields(concurrency));
  }
  return result;
}

/** The output fields a flagged write adds to a tool result. */
export function concurrencyOutputFields(concurrency: ConcurrencyAfterWrite) {
  return {
    concurrent_write_detected: true as const,
    concurrent_write_message: CONCURRENT_WRITE_DETECTED_MESSAGE,
    concurrency_after_write: { status: concurrency.status, signal: concurrency.signal },
  };
}

/** The verification attached to a tool result, if any. */
export function concurrencyFromResult(result: unknown): ConcurrencyAfterWrite | null {
  if (!result || typeof result !== "object") return null;
  const value = (result as Record<PropertyKey, unknown>)[CONCURRENCY_AFTER_WRITE];
  return value && typeof value === "object" ? (value as ConcurrencyAfterWrite) : null;
}

/** A copy of a tool result without the flag output fields (for audit snapshots). */
export function withoutConcurrencyOutput(result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;
  const record = result as Record<string, unknown>;
  if (!FLAG_OUTPUT_KEYS.some((key) => key in record)) return result;
  const copy = { ...record };
  for (const key of FLAG_OUTPUT_KEYS) delete copy[key];
  return copy;
}
