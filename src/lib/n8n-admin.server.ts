// Instance administration tools over the n8n Public API (/api/v1):
// credentials (metadata and type schemas only), projects, folders, tags,
// data tables, executions and the security audit.
//
// Nothing here returns credential secrets: n8n's credential list carries only
// id, name, type and sharing, and the schema endpoint describes fields. Every
// delete goes through the caller's confirmation flow first.
import { summarizeExecution } from "@/lib/n8n-execution.server";

export type AdminRequest = (path: string, init?: RequestInit) => Promise<unknown>;
export type AdminConfirm = (operation: string, scope: Record<string, unknown>) => Promise<void>;

export const ADMIN_TOOL_NAMES = new Set([
  "list_credentials",
  "get_credential_schema",
  "list_projects",
  "manage_folders",
  "manage_tags",
  "manage_data_table",
  "audit_instance",
  "get_execution",
  "delete_execution",
]);

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CREDENTIAL_TYPE = /^[A-Za-z0-9_.-]{1,128}$/;
const DATA_TABLE_ID = /^[A-Za-z0-9]{16}$/;
const MAX_EXECUTION_DATA_CHARS = 100_000;
const AUDIT_CATEGORIES = new Set(["credentials", "database", "nodes", "filesystem", "instance"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function id(value: unknown, field: string, pattern = ID): string {
  const text = typeof value === "number" ? String(value) : value;
  if (typeof text !== "string" || !pattern.test(text)) throw new Error(`${field} is invalid`);
  return encodeURIComponent(text);
}

function name(value: unknown, field = "name"): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${field} is required`);
  if (value.trim().length > 128) throw new Error(`${field} is too long`);
  return value.trim();
}

function pageQuery(args: Record<string, unknown>, extra: Record<string, string> = {}): string {
  const query = new URLSearchParams(extra);
  const limit = Number(args.limit ?? 50);
  query.set(
    "limit",
    String(Number.isFinite(limit) ? Math.min(Math.max(1, Math.floor(limit)), 250) : 50),
  );
  if (typeof args.cursor === "string" && args.cursor) query.set("cursor", args.cursor);
  return query.toString();
}

function json(body: unknown): RequestInit {
  return { body: JSON.stringify(body) };
}

function action(args: Record<string, unknown>, allowed: readonly string[]): string {
  const value = args.action;
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw new Error(`action must be one of ${allowed.join(", ")}`);
  }
  return value;
}

function credentialMetadata(body: unknown) {
  const record = isRecord(body) ? body : {};
  const data = Array.isArray(record.data) ? record.data : [];
  return {
    credentials: data.filter(isRecord).map((item) => ({
      id: item.id,
      name: item.name,
      type: item.type,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
    nextCursor: record.nextCursor ?? null,
  };
}

export async function runAdminTool(
  toolName: string,
  args: Record<string, unknown>,
  request: AdminRequest,
  confirm: AdminConfirm,
): Promise<unknown> {
  switch (toolName) {
    case "list_credentials":
      // Defensive re-mapping: only metadata ever leaves this function.
      return credentialMetadata(await request(`/api/v1/credentials?${pageQuery(args)}`));

    case "get_credential_schema":
      return {
        credentialType: args.credentialType,
        schema: await request(
          `/api/v1/credentials/schema/${id(args.credentialType, "credentialType", CREDENTIAL_TYPE)}`,
        ),
      };

    case "list_projects":
      return request(`/api/v1/projects?${pageQuery(args)}`);

    case "manage_folders": {
      const op = action(args, ["list", "create", "rename", "delete"]);
      const base = `/api/v1/projects/${id(args.projectId, "projectId")}/folders`;
      if (op === "list") return request(base);
      if (op === "create") {
        const body: Record<string, unknown> = { name: name(args.name) };
        if (args.parentFolderId !== undefined)
          body.parentFolderId = decodeURIComponent(id(args.parentFolderId, "parentFolderId"));
        return request(base, { method: "POST", ...json(body) });
      }
      const folder = `${base}/${id(args.folderId, "folderId")}`;
      if (op === "rename")
        return request(folder, { method: "PATCH", ...json({ name: name(args.name) }) });
      await confirm("Delete folder", { projectId: args.projectId, folderId: args.folderId });
      await request(folder, { method: "DELETE" });
      return { success: true, deleted: { folderId: args.folderId } };
    }

    case "manage_tags": {
      const op = action(args, ["list", "create", "rename", "delete"]);
      if (op === "list") return request(`/api/v1/tags?${pageQuery(args)}`);
      if (op === "create")
        return request("/api/v1/tags", { method: "POST", ...json({ name: name(args.name) }) });
      const tag = `/api/v1/tags/${id(args.tagId, "tagId")}`;
      if (op === "rename")
        return request(tag, { method: "PUT", ...json({ name: name(args.name) }) });
      await confirm("Delete tag", { tagId: args.tagId });
      await request(tag, { method: "DELETE" });
      return { success: true, deleted: { tagId: args.tagId } };
    }

    case "manage_data_table": {
      const op = action(args, ["list_tables", "list_rows", "insert_rows", "delete_rows"]);
      if (op === "list_tables") return request(`/api/v1/data-tables?${pageQuery(args)}`);
      const table = `/api/v1/data-tables/${id(args.dataTableId, "dataTableId", DATA_TABLE_ID)}`;
      if (op === "list_rows") {
        const extra: Record<string, string> = {};
        if (args.filter !== undefined) extra.filter = JSON.stringify(args.filter);
        return request(`${table}/rows?${pageQuery(args, extra)}`);
      }
      if (op === "insert_rows") {
        if (!Array.isArray(args.rows) || args.rows.length === 0 || !args.rows.every(isRecord)) {
          throw new Error("rows must be a non-empty array of objects");
        }
        if (args.rows.length > 500) throw new Error("insert at most 500 rows per call");
        return request(`${table}/rows`, {
          method: "POST",
          ...json({ data: args.rows, returnType: "count" }),
        });
      }
      // n8n requires a filter for row deletion so a table cannot be emptied by accident.
      if (!isRecord(args.filter) || Object.keys(args.filter).length === 0) {
        throw new Error("delete_rows requires a filter");
      }
      await confirm("Delete data table rows", {
        dataTableId: args.dataTableId,
        filter: args.filter,
      });
      const query = new URLSearchParams({ filter: JSON.stringify(args.filter) });
      return request(`${table}/rows/delete?${query}`, { method: "DELETE" });
    }

    case "audit_instance": {
      const categories = Array.isArray(args.categories) ? args.categories.map(String) : undefined;
      if (categories?.some((category) => !AUDIT_CATEGORIES.has(category))) {
        throw new Error(`categories must be among ${[...AUDIT_CATEGORIES].join(", ")}`);
      }
      const additionalOptions: Record<string, unknown> = {};
      if (categories?.length) additionalOptions.categories = categories;
      if (args.daysAbandonedWorkflow !== undefined) {
        const days = Number(args.daysAbandonedWorkflow);
        if (!Number.isInteger(days) || days < 1)
          throw new Error("daysAbandonedWorkflow must be a positive integer");
        additionalOptions.daysAbandonedWorkflow = days;
      }
      const report = await request("/api/v1/audit", {
        method: "POST",
        ...json({ additionalOptions }),
      });
      return { report };
    }

    case "get_execution": {
      const includeData = args.includeData === true;
      const raw = await request(
        `/api/v1/executions/${id(args.id, "id")}?includeData=${includeData ? "true" : "false"}`,
      );
      const summary = summarizeExecution(raw);
      if (!includeData) return { execution: summary };
      const serialized = JSON.stringify(isRecord(raw) ? (raw.data ?? null) : null);
      return serialized.length > MAX_EXECUTION_DATA_CHARS
        ? { execution: summary, data: null, dataTruncated: true, dataChars: serialized.length }
        : { execution: summary, data: isRecord(raw) ? (raw.data ?? null) : null };
    }

    case "delete_execution": {
      const executionId = id(args.id, "id");
      await confirm("Delete execution", { executionId: args.id });
      await request(`/api/v1/executions/${executionId}`, { method: "DELETE" });
      return { success: true, deleted: { executionId: args.id } };
    }

    default:
      throw new Error(`Unknown admin tool: ${toolName}`);
  }
}
