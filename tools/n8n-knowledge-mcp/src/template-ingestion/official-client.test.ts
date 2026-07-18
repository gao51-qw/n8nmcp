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

const detail = (id: number) => ({
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

describe("official template client", () => {
  it("accepts workflow summaries when price is absent", async () => {
    const workflowWithoutPrice = {
      id: 1,
      name: "Template 1",
      description: "Description",
      totalViews: 9_999,
      purchaseUrl: null,
      user: { name: "n8n Team", username: "n8n-team", avatar: null },
      createdAt: "2026-07-01T00:00:00.000Z",
      nodes: [],
    };
    const client = createOfficialTemplateClient({
      fetch: vi.fn().mockResolvedValue(
        Response.json({ totalWorkflows: 1, workflows: [workflowWithoutPrice] }),
      ),
    });

    const result = await client.collectSummaries(1);

    expect(result.summaries).toEqual([workflowWithoutPrice]);
    expect(result.summaries[0]).not.toHaveProperty("price");
  });

  it("rejects a malformed present workflow price", async () => {
    const client = createOfficialTemplateClient({
      fetch: vi.fn().mockResolvedValue(
        Response.json({
          totalWorkflows: 1,
          workflows: [{ ...summary(1), price: "free" }],
        }),
      ),
    });

    await expect(client.collectSummaries(1)).rejects.toThrow();
  });

  it("accepts workflow summaries when purchaseUrl is absent", async () => {
    const workflowWithoutPurchaseUrl = {
      id: 1,
      name: "Template 1",
      description: "Description",
      totalViews: 9_999,
      price: 0,
      user: { name: "n8n Team", username: "n8n-team", avatar: null },
      createdAt: "2026-07-01T00:00:00.000Z",
      nodes: [],
    };
    const client = createOfficialTemplateClient({
      fetch: vi.fn().mockResolvedValue(
        Response.json({ totalWorkflows: 1, workflows: [workflowWithoutPurchaseUrl] }),
      ),
    });

    const result = await client.collectSummaries(1);

    expect(result.summaries).toEqual([workflowWithoutPurchaseUrl]);
    expect(result.summaries[0]).not.toHaveProperty("purchaseUrl");
  });

  it("rejects a malformed present workflow purchaseUrl", async () => {
    const client = createOfficialTemplateClient({
      fetch: vi.fn().mockResolvedValue(
        Response.json({
          totalWorkflows: 1,
          workflows: [{ ...summary(1), purchaseUrl: 42 }],
        }),
      ),
    });

    await expect(client.collectSummaries(1)).rejects.toThrow();
  });

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

  it("never collects more than 5,000 unique summaries", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({
          totalWorkflows: 6_000,
          workflows: Array.from({ length: 5_001 }, (_, index) => summary(index + 1)),
        }),
      )
      .mockResolvedValueOnce(Response.json({ totalWorkflows: 6_000, workflows: [] }));
    const client = createOfficialTemplateClient({ fetch, pageSize: 5_001 });

    const result = await client.collectSummaries(10_000);

    expect(result.target).toBe(5_000);
    expect(result.summaries).toHaveLength(5_000);
    expect(result.summaries.at(-1)?.id).toBe(5_000);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("keeps the first advertised total stable across pagination", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        Response.json({ totalWorkflows: 5, workflows: [summary(1), summary(2)] }),
      )
      .mockResolvedValueOnce(
        Response.json({ totalWorkflows: 100, workflows: [summary(3), summary(4)] }),
      )
      .mockResolvedValueOnce(
        Response.json({ totalWorkflows: 100, workflows: [summary(5), summary(6)] }),
      )
      .mockResolvedValueOnce(Response.json({ totalWorkflows: 100, workflows: [] }));
    const client = createOfficialTemplateClient({ fetch, pageSize: 2 });

    const result = await client.collectSummaries(10);

    expect(result.totalWorkflows).toBe(5);
    expect(result.target).toBe(5);
    expect(result.summaries.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
    expect(fetch).toHaveBeenCalledTimes(3);
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

  it("never makes more than three attempts", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 }));
    const client = createOfficialTemplateClient({ fetch, maxAttempts: 99, sleep: vi.fn() });

    await expect(client.collectSummaries(1)).rejects.toThrow(/three|3|attempt/i);

    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("never waits more than 15 seconds for a request", async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      const fetch = vi.fn(
        (_input: URL | RequestInfo, init?: RequestInit) =>
          new Promise<Response>((resolve) => {
            requestSignal = init?.signal ?? undefined;
            requestSignal?.addEventListener(
              "abort",
              () => resolve(Response.json({ totalWorkflows: 0, workflows: [] })),
              { once: true },
            );
          }),
      );
      const client = createOfficialTemplateClient({
        fetch,
        maxAttempts: 1,
        requestTimeoutMs: 60_000,
      });

      const pending = client.collectSummaries(1);
      await vi.advanceTimersByTimeAsync(14_999);
      expect(requestSignal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(requestSignal?.aborted).toBe(true);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ["requestTimeoutMs", { requestTimeoutMs: 0 }],
    ["requestTimeoutMs", { requestTimeoutMs: -1 }],
    ["requestTimeoutMs", { requestTimeoutMs: Number.NaN }],
    ["requestTimeoutMs", { requestTimeoutMs: Number.POSITIVE_INFINITY }],
    ["maxAttempts", { maxAttempts: 0 }],
    ["maxAttempts", { maxAttempts: -1 }],
    ["maxAttempts", { maxAttempts: Number.NaN }],
    ["maxAttempts", { maxAttempts: Number.POSITIVE_INFINITY }],
    ["detailConcurrency", { detailConcurrency: 0 }],
    ["detailConcurrency", { detailConcurrency: -1 }],
    ["detailConcurrency", { detailConcurrency: Number.NaN }],
    ["detailConcurrency", { detailConcurrency: Number.POSITIVE_INFINITY }],
  ])("rejects invalid %s values", (name, options) => {
    expect(() => createOfficialTemplateClient(options)).toThrow(new RegExp(name));
  });

  it("accepts lower positive finite safety settings", () => {
    expect(() =>
      createOfficialTemplateClient({
        requestTimeoutMs: 1,
        maxAttempts: 1,
        detailConcurrency: 1,
      }),
    ).not.toThrow();
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
      return Response.json(detail(id));
    });
    const client = createOfficialTemplateClient({ fetch, detailConcurrency: 12 });

    await client.fetchDetails(Array.from({ length: 12 }, (_, index) => summary(index + 1)));

    expect(peak).toBe(4);
  });

  it("deduplicates and caps detail input at 5,000 IDs", async () => {
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      const id = Number(input.toString().split("/").at(-1));
      return Response.json(detail(id));
    });
    const client = createOfficialTemplateClient({ fetch });
    const summaries = [
      summary(1),
      summary(1),
      ...Array.from({ length: 5_000 }, (_, index) => summary(index + 2)),
    ];

    const result = await client.fetchDetails(summaries);

    expect(fetch).toHaveBeenCalledTimes(5_000);
    expect(result.details).toHaveLength(5_000);
    expect(new Set(result.details.map((item) => item.id)).size).toBe(5_000);
    expect(result.details.at(-1)?.id).toBe(5_000);
  });

  it.each(["text/application/json", "application/jsonp"])(
    "rejects misleading JSON content type %s",
    async (contentType) => {
      const client = createOfficialTemplateClient({
        fetch: vi.fn().mockResolvedValue(
          new Response(JSON.stringify({ totalWorkflows: 0, workflows: [] }), {
            headers: { "content-type": contentType },
          }),
        ),
      });

      await expect(client.collectSummaries(1)).rejects.toThrow(/content-type/i);
    },
  );

  it.each([
    "application/json",
    "application/json; charset=utf-8",
    "application/problem+json",
    "application/vnd.api+json; charset=utf-8",
  ])("accepts valid JSON content type %s", async (contentType) => {
    const client = createOfficialTemplateClient({
      fetch: vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ totalWorkflows: 0, workflows: [] }), {
          headers: { "content-type": contentType },
        }),
      ),
    });

    await expect(client.collectSummaries(1)).resolves.toMatchObject({ summaries: [] });
  });

  it.each([
    ["absent", undefined],
    ["dishonest", "10"],
  ])("rejects streamed overflow with %s Content-Length", async (_name, contentLength) => {
    const headers = new Headers({ "content-type": "application/json" });
    if (contentLength !== undefined) headers.set("content-length", contentLength);
    const client = createOfficialTemplateClient({
      fetch: vi.fn().mockResolvedValue(new Response("x".repeat(1_025), { headers })),
      maxResponseBytes: 1_024,
    });

    await expect(client.collectSummaries(1)).rejects.toThrow(/too large/i);
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
