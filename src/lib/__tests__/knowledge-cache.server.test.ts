import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  cachedKnowledgeCall,
  clearKnowledgeCacheForTests,
  KNOWLEDGE_CACHE_TTL_MS,
} from "../knowledge-cache.server";

beforeEach(() => {
  clearKnowledgeCacheForTests();
  vi.useRealTimers();
});

describe("cachedKnowledgeCall", () => {
  it("serves repeated lookups with the same arguments from the cache", async () => {
    const load = vi.fn(async () => ({ results: ["webhook"] }));
    await cachedKnowledgeCall("search_nodes", { query: "webhook", limit: 5 }, load);
    await expect(
      cachedKnowledgeCall("search_nodes", { limit: 5, query: "webhook" }, load),
    ).resolves.toEqual({
      results: ["webhook"],
    });
    expect(load).toHaveBeenCalledTimes(1);
    await cachedKnowledgeCall("search_nodes", { query: "slack", limit: 5 }, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("expires entries after five minutes", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => ({ ok: true }));
    await cachedKnowledgeCall("get_node_essentials", { nodeType: "webhook" }, load);
    vi.advanceTimersByTime(KNOWLEDGE_CACHE_TTL_MS + 1);
    await cachedKnowledgeCall("get_node_essentials", { nodeType: "webhook" }, load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("does not cache errors or tools outside the allow-list", async () => {
    const failing = vi.fn(async () => ({ isError: true, content: [] }));
    await cachedKnowledgeCall("search_templates", { query: "x" }, failing);
    await cachedKnowledgeCall("search_templates", { query: "x" }, failing);
    expect(failing).toHaveBeenCalledTimes(2);

    const validate = vi.fn(async () => ({ ok: true }));
    await cachedKnowledgeCall("validate_workflow", { workflow: {} }, validate);
    await cachedKnowledgeCall("validate_workflow", { workflow: {} }, validate);
    expect(validate).toHaveBeenCalledTimes(2);
  });
});
