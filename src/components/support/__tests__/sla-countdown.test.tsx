// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SlaCountdown } from "../sla-countdown";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe("SlaCountdown", () => {
  const roots: Root[] = [];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-12T10:00:00.000Z"));
  });

  afterEach(async () => {
    for (const root of roots) await act(async () => root.unmount());
    roots.length = 0;
    document.body.innerHTML = "";
    vi.useRealTimers();
  });

  async function render(dueAt: string | null) {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<SlaCountdown dueAt={dueAt} />));
    return host;
  }

  it("renders a distinct accessible due-soon state only within the next 30 minutes", async () => {
    const host = await render("2026-06-12T10:30:00.000Z");
    const countdown = host.querySelector('[data-sla-state="due-soon"]');

    expect(countdown).not.toBeNull();
    expect(countdown?.getAttribute("aria-label")).toBe(
      "First response due soon, 30 minutes remaining",
    );
    expect(countdown?.textContent).toContain("Response due soon");
  });

  it("keeps the breached state when the due time has passed", async () => {
    const host = await render("2026-06-12T09:55:00.000Z");
    const countdown = host.querySelector('[data-sla-state="breached"]');

    expect(countdown).not.toBeNull();
    expect(countdown?.getAttribute("aria-label")).toBe("First response SLA breached by 5 minutes");
    expect(countdown?.textContent).toContain("Response overdue by 5m");
  });

  it("does not mark targets over 30 minutes away as due soon", async () => {
    const host = await render("2026-06-12T10:31:00.000Z");

    expect(host.querySelector('[data-sla-state="pending"]')).not.toBeNull();
    expect(host.textContent).toContain("Response target 31m");
  });
});
