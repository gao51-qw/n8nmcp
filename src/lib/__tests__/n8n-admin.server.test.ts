import { beforeEach, describe, expect, it, vi } from "vitest";
import { runAdminTool } from "../n8n-admin.server";

const request = vi.fn();
const confirm = vi.fn();

function run(name: string, args: Record<string, unknown>) {
  return runAdminTool(name, args, request, confirm);
}

function lastCall() {
  const [path, init] = request.mock.calls.at(-1) as [string, RequestInit | undefined];
  return {
    path,
    method: init?.method ?? "GET",
    body: init?.body ? JSON.parse(String(init.body)) : undefined,
  };
}

beforeEach(() => {
  request.mockReset().mockResolvedValue({});
  confirm.mockReset().mockResolvedValue(undefined);
});

describe("credentials", () => {
  it("returns only credential metadata, even if n8n sent more", async () => {
    request.mockResolvedValueOnce({
      data: [
        {
          id: "c1",
          name: "Slack",
          type: "slackApi",
          createdAt: "t",
          updatedAt: "u",
          data: { accessToken: "xoxb-secret" },
          shared: [{ id: "p1" }],
        },
      ],
      nextCursor: "next",
    });

    const result = await run("list_credentials", { limit: 1000 });

    expect(lastCall().path).toBe("/api/v1/credentials?limit=250");
    expect(result).toEqual({
      credentials: [{ id: "c1", name: "Slack", type: "slackApi", createdAt: "t", updatedAt: "u" }],
      nextCursor: "next",
    });
    expect(JSON.stringify(result)).not.toContain("xoxb-secret");
  });

  it("reads a credential type schema and validates the type name", async () => {
    await run("get_credential_schema", { credentialType: "slackApi" });
    expect(lastCall().path).toBe("/api/v1/credentials/schema/slackApi");
    await expect(run("get_credential_schema", { credentialType: "../users" })).rejects.toThrow(
      /invalid/,
    );
  });
});

describe("folders and tags", () => {
  it("creates and renames folders without confirmation", async () => {
    await run("manage_folders", {
      action: "create",
      projectId: "p1",
      name: " Reports ",
      parentFolderId: "f0",
    });
    expect(lastCall()).toEqual({
      path: "/api/v1/projects/p1/folders",
      method: "POST",
      body: { name: "Reports", parentFolderId: "f0" },
    });
    await run("manage_folders", { action: "rename", projectId: "p1", folderId: "f1", name: "Q4" });
    expect(lastCall()).toMatchObject({ path: "/api/v1/projects/p1/folders/f1", method: "PATCH" });
    expect(confirm).not.toHaveBeenCalled();
  });

  it("confirms before deleting a folder and stops when confirmation fails", async () => {
    confirm.mockRejectedValueOnce(new Error("Delete folder requires confirmation"));
    await expect(
      run("manage_folders", { action: "delete", projectId: "p1", folderId: "f1" }),
    ).rejects.toThrow(/requires confirmation/);
    expect(request).not.toHaveBeenCalled();

    await run("manage_folders", { action: "delete", projectId: "p1", folderId: "f1" });
    expect(confirm).toHaveBeenLastCalledWith("Delete folder", { projectId: "p1", folderId: "f1" });
    expect(lastCall()).toMatchObject({ path: "/api/v1/projects/p1/folders/f1", method: "DELETE" });
  });

  it("manages tags with the same rules", async () => {
    await run("manage_tags", { action: "list" });
    expect(lastCall().path).toBe("/api/v1/tags?limit=50");
    await run("manage_tags", { action: "rename", tagId: "t1", name: "prod" });
    expect(lastCall()).toMatchObject({
      path: "/api/v1/tags/t1",
      method: "PUT",
      body: { name: "prod" },
    });
    await run("manage_tags", { action: "delete", tagId: "t1" });
    expect(confirm).toHaveBeenCalledWith("Delete tag", { tagId: "t1" });
  });

  it.each([
    ["an unknown action", "manage_tags", { action: "purge" }],
    ["a missing name", "manage_tags", { action: "create" }],
    ["a path-like id", "manage_folders", { action: "list", projectId: "../x" }],
  ])("rejects %s", async (_label, tool, args) => {
    await expect(run(tool, args)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
});

describe("data tables", () => {
  const table = "AbCdEfGhIjKlMnOp";

  it("lists rows with a JSON filter and inserts rows", async () => {
    const filter = {
      type: "and",
      filters: [{ columnName: "status", condition: "eq", value: "open" }],
    };
    await run("manage_data_table", { action: "list_rows", dataTableId: table, filter, limit: 10 });
    expect(lastCall().path).toBe(
      `/api/v1/data-tables/${table}/rows?${new URLSearchParams({ filter: JSON.stringify(filter), limit: "10" })}`,
    );
    await run("manage_data_table", { action: "insert_rows", dataTableId: table, rows: [{ a: 1 }] });
    expect(lastCall()).toEqual({
      path: `/api/v1/data-tables/${table}/rows`,
      method: "POST",
      body: { data: [{ a: 1 }], returnType: "count" },
    });
  });

  it("requires a filter and confirmation to delete rows", async () => {
    await expect(
      run("manage_data_table", { action: "delete_rows", dataTableId: table }),
    ).rejects.toThrow(/requires a filter/);
    const filter = { type: "and", filters: [{ columnName: "id", condition: "eq", value: 3 }] };
    await run("manage_data_table", { action: "delete_rows", dataTableId: table, filter });
    expect(confirm).toHaveBeenCalledWith("Delete data table rows", { dataTableId: table, filter });
    expect(lastCall()).toMatchObject({ method: "DELETE" });
    expect(lastCall().path).toContain(`/api/v1/data-tables/${table}/rows/delete?filter=`);
  });

  it("rejects malformed ids and oversized inserts", async () => {
    await expect(
      run("manage_data_table", { action: "list_rows", dataTableId: "short" }),
    ).rejects.toThrow(/invalid/);
    await expect(
      run("manage_data_table", {
        action: "insert_rows",
        dataTableId: table,
        rows: Array.from({ length: 501 }, () => ({})),
      }),
    ).rejects.toThrow(/at most 500/);
  });
});

describe("executions and audit", () => {
  it("summarizes an execution and drops oversized run data", async () => {
    request.mockResolvedValueOnce({
      id: 7,
      status: "error",
      data: { resultData: { error: { message: "boom" }, blob: "x".repeat(200_000) } },
    });
    const result = (await run("get_execution", { id: "7", includeData: true })) as Record<
      string,
      unknown
    >;
    expect(lastCall().path).toBe("/api/v1/executions/7?includeData=true");
    expect(result).toMatchObject({
      execution: { id: "7", status: "error", error: "boom" },
      data: null,
      dataTruncated: true,
    });
  });

  it("confirms before deleting an execution", async () => {
    await run("delete_execution", { id: "7" });
    expect(confirm).toHaveBeenCalledWith("Delete execution", { executionId: "7" });
    expect(lastCall()).toEqual({ path: "/api/v1/executions/7", method: "DELETE", body: undefined });
  });

  it("runs the security audit for the requested categories", async () => {
    request.mockResolvedValueOnce({ "Credentials Risk Report": { risk: "credentials" } });
    await expect(
      run("audit_instance", { categories: ["credentials"], daysAbandonedWorkflow: 30 }),
    ).resolves.toEqual({
      report: { "Credentials Risk Report": { risk: "credentials" } },
    });
    expect(lastCall()).toEqual({
      path: "/api/v1/audit",
      method: "POST",
      body: { additionalOptions: { categories: ["credentials"], daysAbandonedWorkflow: 30 } },
    });
    await expect(run("audit_instance", { categories: ["everything"] })).rejects.toThrow(
      /categories/,
    );
  });
});
