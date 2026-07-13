import { describe, expect, it, vi } from "vitest";
import { createOfficialTemplateClient } from "./official-client.js";

const summary = (id: number) => ({
  id,
  name: `Template ${id}`,
  description: "Description",
  totalViews: 10_000 - id,
  price: 0,
  purchaseUrl: null,
  user: { name: "n8n Team", username: "n8n-team", avatar: null },
  createdAt: "2026-07-01T00:00:00.000Z",
  nodes: [],
});

describe("official template client", () => {
  it("deduplicates paginated results and stops at the configured limit", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          totalWorkflows: 6,
          workflows: [summary(1), summary(2), summary(3)],
        }),
      )
      .mockResolvedValueOnce(
        Response.json({
          totalWorkflows: 6,
          workflows: [summary(3), summary(4), summary(5)],
        }),
      );
    const client = createOfficialTemplateClient({ fetch, pageSize: 3, sleep: vi.fn() });

    const result = await client.collectSummaries(5);

    expect(result.summaries.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.target).toBe(5);
    expect(fetch.mock.calls[0]?.[0].toString()).toContain("sort=views%3Adesc");
  });

  it("honors Retry-After and succeeds within three attempts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("rate limited", { status: 429, headers: { "Retry-After": "2" } }),
      )
      .mockResolvedValueOnce(Response.json({ totalWorkflows: 0, workflows: [] }));
    const client = createOfficialTemplateClient({ fetch, sleep });

    await client.collectSummaries(10);

    expect(fetch).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(2_000);
  });

  it("never runs more than four detail requests concurrently", async () => {
    let active = 0;
    let peak = 0;
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      const id = Number(input.toString().split("/").at(-1));
      return Response.json({
        id,
        name: `Template ${id}`,
        workflow: {
          nodes: [
            {
              id: "n1",
              name: "Start",
              type: "n8n-nodes-base.manualTrigger",
              parameters: {},
              position: [0, 0],
            },
          ],
          connections: {},
        },
      });
    });
    const client = createOfficialTemplateClient({ fetch, detailConcurrency: 4 });

    await client.fetchDetails(Array.from({ length: 12 }, (_, index) => summary(index + 1)));

    expect(peak).toBe(4);
  });

  it.each([
    [
      "redirect",
      new Response(null, {
        status: 302,
        headers: { location: "https://evil.example/templates/1" },
      }),
      /redirect/i,
    ],
    [
      "content type",
      new Response("html", { headers: { "content-type": "text/html" } }),
      /content-type/i,
    ],
    [
      "body size",
      new Response("x".repeat(1_025), {
        headers: { "content-type": "application/json", "content-length": "1025" },
      }),
      /too large/i,
    ],
  ])("rejects unsafe %s responses", async (_name, response, error) => {
    const client = createOfficialTemplateClient({
      fetch: vi.fn().mockResolvedValue(response),
      maxResponseBytes: 1_024,
    });
    await expect(client.collectSummaries(1)).rejects.toThrow(error);
  });
});
