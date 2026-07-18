// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkflowAgentConsole, workflowAgentConsoleFixture } from "../agent-console";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

async function render(node: React.ReactNode) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(node));
  return { host, root };
}

function buttonByText(host: HTMLElement, label: string) {
  return Array.from(host.querySelectorAll("button")).find((button) =>
    button.textContent?.includes(label),
  );
}

describe("WorkflowAgentConsole", () => {
  const roots: Root[] = [];

  afterEach(async () => {
    for (const root of roots) await act(async () => root.unmount());
    roots.length = 0;
    document.body.innerHTML = "";
  });

  it("renders the workflow-agent operations panels from fixture data", async () => {
    const view = await render(<WorkflowAgentConsole data={workflowAgentConsoleFixture} />);
    roots.push(view.root);

    expect(view.host.textContent).toContain("Workflow Agent Console");
    expect(view.host.textContent).toContain("Environment");
    expect(view.host.textContent).toContain("Development");
    expect(view.host.textContent).toContain("Staging");
    expect(view.host.textContent).toContain("Production");
    expect(view.host.textContent).toContain("Write-enabled");
    expect(view.host.textContent).toContain("Quota and rate limits");
    expect(view.host.textContent).toContain("Tool-call timeline");
    expect(view.host.textContent).toContain("Workflow diff preview");
    expect(view.host.textContent).toContain("Validation results");
    expect(view.host.textContent).toContain("AI reasoning and audit log");
  });

  it("disables rollback and apply while read-only is active", async () => {
    const view = await render(
      <WorkflowAgentConsole data={{ ...workflowAgentConsoleFixture, mode: "read-only" }} />,
    );
    roots.push(view.root);

    expect(buttonByText(view.host, "Rollback")?.hasAttribute("disabled")).toBe(true);
    expect(buttonByText(view.host, "Apply update")?.hasAttribute("disabled")).toBe(true);
  });

  it("disables rollback after rollback and apply when validation has errors", async () => {
    const view = await render(
      <WorkflowAgentConsole
        data={{
          ...workflowAgentConsoleFixture,
          mode: "write-enabled",
          rollbackStatus: "rolled-back",
        }}
      />,
    );
    roots.push(view.root);

    expect(buttonByText(view.host, "Rollback")?.hasAttribute("disabled")).toBe(true);
    expect(buttonByText(view.host, "Apply update")?.hasAttribute("disabled")).toBe(true);
  });

  it("submits only selected trusted preview operations", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    const view = await render(
      <WorkflowAgentConsole
        data={{
          ...workflowAgentConsoleFixture,
          validation: [],
          pendingUpdate: {
            previewCallId: "preview-1",
            workflowId: "wf-1",
            createdAt: "2026-07-09T10:00:00.000Z",
            expiresAt: "2026-07-09T10:30:00.000Z",
            baseFingerprint: "fingerprint-1",
            operations: [
              {
                index: 0,
                operation: { type: "cleanStaleConnections" },
                summary: { id: "op-0", operation: "update", target: "Connections" },
              },
              {
                index: 1,
                operation: { type: "removeNode", nodeId: "old-node" },
                summary: { id: "op-1", operation: "remove", target: "Old node" },
              },
            ],
          },
        }}
        actionState={{ status: "idle" }}
        onApply={onApply}
        onRollback={vi.fn()}
      />,
    );
    roots.push(view.root);

    const selections = view.host.querySelectorAll<HTMLInputElement>("input[data-operation-index]");
    await act(async () => selections[1]?.click());
    await act(async () => buttonByText(view.host, "Apply update")?.click());

    expect(onApply).toHaveBeenCalledWith({
      previewCallId: "preview-1",
      selectedOperationIndexes: [0],
    });
  });

  it("submits the server-provided rollback candidate and waits for the callback", async () => {
    let resolveRollback!: () => void;
    const onRollback = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          resolveRollback = resolve;
        }),
    );
    const view = await render(
      <WorkflowAgentConsole
        data={{
          ...workflowAgentConsoleFixture,
          validation: [],
          rollbackCandidate: {
            auditLogId: "audit-1",
            workflowId: "wf-1",
            createdAt: "2026-07-09T10:00:00.000Z",
          },
        }}
        actionState={{ status: "idle" }}
        onApply={vi.fn()}
        onRollback={onRollback}
      />,
    );
    roots.push(view.root);

    await act(async () => buttonByText(view.host, "Rollback")?.click());
    expect(onRollback).toHaveBeenCalledWith({ auditLogId: "audit-1", reason: expect.any(String) });
    expect(buttonByText(view.host, "Rollback")?.hasAttribute("disabled")).toBe(true);
    await act(async () => resolveRollback());
  });
});
