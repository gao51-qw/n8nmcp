# Knowledge Template Import and Scheduled Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import up to 5,000 public n8n workflow templates into the Knowledge MCP, retain a curated offline fallback, rebuild weekly or manually, publish only the verified database image, and deploy it to the VPS with health-checked rollback.

**Architecture:** Fetch official template metadata and details into an isolated staging directory, normalize and sanitize them without executing workflow code, merge them with reviewed repository snapshots, then import the deterministic result into SQLite/FTS5. Build the database once in CI, copy that exact verified database into the image, smoke-test it, publish immutable and `latest` tags, and deploy only the immutable tag through an SSH script that can restore the prior tag.

**Tech Stack:** TypeScript 5.7, Node.js 20+, native `fetch`, Zod 3, better-sqlite3, Vitest, Docker Buildx, GitHub Actions, Bash, Docker Compose.

## Global Constraints

- Preserve unrelated dirty-worktree changes and stage only files listed by the active task.
- Fetch templates only from `https://api.n8n.io`.
- Sort search pages by `views:desc` and fetch at most 5,000 unique official template IDs.
- Use a 15-second request timeout, at most three attempts, and at most four simultaneous detail requests.
- Honor bounded `Retry-After` values for HTTP 429 responses.
- Never execute downloaded workflows, nodes, expressions, or code.
- Never log or persist raw credentials, tokens, private keys, or secret-bearing workflow bodies.
- Require at least 95% of `min(totalWorkflows, 5000)` official details; when at least 5,000 are advertised, require at least 4,750 accepted official templates.
- Keep every curated template while capping the final merged database at 5,000 templates.
- Official-source or quality-gate failure may produce a curated fallback artifact, but must not update `latest` or deploy production.
- Run every Monday at 02:00 UTC and support `workflow_dispatch`.
- Publish an immutable image tag before advancing `latest`.
- Use strict SSH host-key checking and roll back automatically when the deployed Knowledge MCP is unhealthy or reports the wrong template count.
- Use visible red-green-refactor cycles and commit after each task.

## File Map

Create focused template-ingestion modules under `tools/n8n-knowledge-mcp/src/template-ingestion/`:

- `types.ts`: shared official, normalized, manifest, and quality-report types.
- `official-client.ts`: allowed-origin HTTP client, retries, pagination, and bounded detail workers.
- `template-security.ts`: normalization, secret rejection, prohibited-node removal, and connection cleanup.
- `source-merge.ts`: deterministic official/curated merge and 5,000-record cap.
- `template-importer.ts`: network-free SQLite/FTS import.
- `quality-gate.ts`: database and manifest validation plus report generation.

Create thin CLI scripts under `tools/n8n-knowledge-mcp/scripts/`, a tracked curated manifest and generated sanitized snapshots under `data/curated-templates/`, a Knowledge MCP-specific `.dockerignore`, an SSH deployment script, and contract tests for the workflow and deployment path.

Modify the existing template CLI, statistics/health plumbing, package scripts, Dockerfile, GitHub workflow, deployment examples, and documentation without changing the public MCP tool names.

---

### Task 1: Official n8n Template API Client

**Files:**
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/types.ts`
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/official-client.ts`
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/official-client.test.ts`

**Interfaces:**
- Produces: `OfficialTemplateSummary`, `OfficialTemplateDetail`, `OfficialFetchManifest`, `OfficialTemplateClientOptions`.
- Produces: `createOfficialTemplateClient(options)` with `collectSummaries(limit)` and `fetchDetails(summaries)`.
- Consumes later: Task 2 normalizes `OfficialTemplateDetail`; Task 3 uses `OfficialFetchManifest`.

- [ ] **Step 1: Define the failing pagination, retry, origin, size, and concurrency tests**

Create fixture helpers inside the test file and cover the complete client contract:

```ts
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
    const fetch = vi.fn()
      .mockResolvedValueOnce(Response.json({ totalWorkflows: 6, workflows: [summary(1), summary(2), summary(3)] }))
      .mockResolvedValueOnce(Response.json({ totalWorkflows: 6, workflows: [summary(3), summary(4), summary(5)] }));
    const client = createOfficialTemplateClient({ fetch, pageSize: 3, sleep: vi.fn() });

    const result = await client.collectSummaries(5);

    expect(result.summaries.map((item) => item.id)).toEqual([1, 2, 3, 4, 5]);
    expect(result.target).toBe(5);
    expect(fetch.mock.calls[0]?.[0].toString()).toContain("sort=views%3Adesc");
  });

  it("honors Retry-After and succeeds within three attempts", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response("rate limited", { status: 429, headers: { "Retry-After": "2" } }))
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
      return Response.json({ id, name: `Template ${id}`, workflow: { nodes: [{ id: "n1", name: "Start", type: "n8n-nodes-base.manualTrigger", parameters: {}, position: [0, 0] }], connections: {} } });
    });
    const client = createOfficialTemplateClient({ fetch, detailConcurrency: 4 });

    await client.fetchDetails(Array.from({ length: 12 }, (_, index) => summary(index + 1)));

    expect(peak).toBe(4);
  });

  it.each([
    ["redirect", new Response(null, { status: 302, headers: { location: "https://evil.example/templates/1" } }), /redirect/i],
    ["content type", new Response("html", { headers: { "content-type": "text/html" } }), /content-type/i],
    ["body size", new Response("x".repeat(1_025), { headers: { "content-type": "application/json", "content-length": "1025" } }), /too large/i],
  ])("rejects unsafe %s responses", async (_name, response, error) => {
    const client = createOfficialTemplateClient({ fetch: vi.fn().mockResolvedValue(response), maxResponseBytes: 1_024 });
    await expect(client.collectSummaries(1)).rejects.toThrow(error);
  });
});
```

- [ ] **Step 2: Run the client tests to verify RED**

Run:

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/template-ingestion/official-client.test.ts
```

Expected: FAIL because `types.ts` and `official-client.ts` do not exist.

- [ ] **Step 3: Implement the shared types and client**

Define the public types exactly:

```ts
export type OfficialTemplateSummary = {
  id: number;
  name: string;
  description: string | null;
  totalViews: number;
  price: number;
  purchaseUrl: string | null;
  user: { name?: string; username?: string; avatar?: string | null } | null;
  createdAt: string | null;
  nodes: unknown[];
};

export type OfficialTemplateDetail = {
  id: number;
  name: string;
  description?: string | null;
  totalViews?: number;
  user?: OfficialTemplateSummary["user"];
  workflow: { nodes: unknown[]; connections: Record<string, unknown>; [key: string]: unknown };
};

export type OfficialFetchManifest = {
  source: "https://api.n8n.io";
  totalWorkflows: number;
  target: number;
  summaryCount: number;
  detailSuccessCount: number;
  detailFailureCount: number;
  failedIds: number[];
  acceptedCount: number;
  rejectedCount: number;
  rejectedIds: number[];
  generatedAt: string;
};

export type OfficialTemplateClientOptions = {
  fetch?: typeof globalThis.fetch;
  sleep?: (ms: number) => Promise<void>;
  pageSize?: number;
  detailConcurrency?: number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  maxResponseBytes?: number;
};
```

Implement `createOfficialTemplateClient` with these exact defaults:

```ts
const ORIGIN = "https://api.n8n.io";
const defaults = {
  pageSize: 100,
  detailConcurrency: 4,
  requestTimeoutMs: 15_000,
  maxAttempts: 3,
  maxResponseBytes: 10_485_760,
};

export function createOfficialTemplateClient(options: OfficialTemplateClientOptions = {}) {
  const config = { ...defaults, ...options };
  const request = options.fetch ?? globalThis.fetch;
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));

  return {
    collectSummaries: (limit = 5_000) => collectSummaries({ config, request, sleep, limit }),
    fetchDetails: (summaries: OfficialTemplateSummary[]) => fetchDetails({ config, request, sleep, summaries }),
  };
}
```

Use `redirect: "manual"`, an `AbortController`, `content-type` and byte-length validation, Zod schemas for both response shapes, and a four-worker index queue rather than adding a concurrency dependency. Retry only timeouts, 429, and 5xx. Reject other 3xx/4xx responses immediately. Clamp `Retry-After` to 30 seconds.

- [ ] **Step 4: Run tests and type-check to verify GREEN**

Run:

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/template-ingestion/official-client.test.ts
npm --prefix tools/n8n-knowledge-mcp run build
```

Expected: client tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit the client**

```powershell
git add -- tools/n8n-knowledge-mcp/src/template-ingestion/types.ts tools/n8n-knowledge-mcp/src/template-ingestion/official-client.ts tools/n8n-knowledge-mcp/src/template-ingestion/official-client.test.ts
git commit -m "feat(knowledge): add official template client"
```

---

### Task 2: Normalize and Sanitize Workflow Templates

**Files:**
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/template-security.ts`
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/template-security.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/template-ingestion/types.ts`

**Interfaces:**
- Consumes: `OfficialTemplateDetail` from Task 1.
- Produces: `NormalizedTemplateEnvelope` and `normalizeAndSanitizeTemplate(detail, summary?)`.
- Produces: `PROHIBITED_TEMPLATE_NODE_TYPES` and `assertTemplateContainsNoSecrets(workflow)`.

- [ ] **Step 1: Write failing sanitizer and graph-cleanup tests**

```ts
import { describe, expect, it } from "vitest";
import { normalizeAndSanitizeTemplate } from "./template-security.js";

describe("template security", () => {
  it("removes credentials, authentication fields, prohibited nodes, and stale connections", () => {
    const result = normalizeAndSanitizeTemplate({
      id: 1750,
      name: "Webhook API",
      description: "Example",
      totalViews: 100,
      workflow: {
        nodes: [
          { id: "safe", name: "Webhook", type: "n8n-nodes-base.webhook", credentials: { httpBasicAuth: { id: "secret" } }, parameters: { authentication: "basicAuth", path: "demo" }, position: [0, 0] },
          { id: "danger", name: "Shell", type: "n8n-nodes-base.executeCommand", parameters: { command: "whoami" }, position: [200, 0] },
        ],
        connections: {
          Webhook: { main: [[{ node: "Shell", type: "main", index: 0 }]] },
          Shell: { main: [[]] },
        },
      },
    });

    const workflow = result.workflow.workflow;
    expect(workflow.nodes).toHaveLength(1);
    expect(workflow.nodes[0]).not.toHaveProperty("credentials");
    expect(workflow.nodes[0].parameters).not.toHaveProperty("authentication");
    expect(workflow.connections).toEqual({});
  });

  it.each([
    "sk-abcdefghijklmnopqrstuvwxyz123456",
    "Bearer abcdefghijklmnopqrstuvwxyz123456",
    "-----BEGIN PRIVATE KEY-----\\nsecret\\n-----END PRIVATE KEY-----",
    "xox" + "b-123456789012-abcdefghijklmnopqrstuvwxyz",
  ])("rejects embedded secret %s", (secret) => {
    expect(() => normalizeAndSanitizeTemplate({
      id: 1,
      name: "Unsafe",
      workflow: {
        nodes: [{ id: "n1", name: "HTTP", type: "n8n-nodes-base.httpRequest", parameters: { body: secret }, position: [0, 0] }],
        connections: {},
      },
    })).toThrow(/secret/i);
  });

  it("rejects empty and malformed workflows", () => {
    expect(() => normalizeAndSanitizeTemplate({ id: 1, name: "Empty", workflow: { nodes: [], connections: {} } })).toThrow(/nodes/i);
  });
});
```

- [ ] **Step 2: Run the sanitizer tests to verify RED**

Run:

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/template-ingestion/template-security.test.ts
```

Expected: FAIL because `template-security.ts` does not exist.

- [ ] **Step 3: Implement normalized envelopes and fail-closed sanitization**

Add the normalized type:

```ts
export type NormalizedTemplateEnvelope = {
  source: "official" | "curated";
  curated: boolean;
  views: number;
  workflow: {
    id: number;
    name: string;
    description: string;
    totalViews: number;
    createdAt: string | null;
    user: { name?: string; username?: string; avatar?: string | null } | null;
    workflow: {
      nodes: Array<Record<string, unknown>>;
      connections: Record<string, unknown>;
      [key: string]: unknown;
    };
  };
  sourceUrl: string;
};
```

Use these prohibited node types:

```ts
export const PROHIBITED_TEMPLATE_NODE_TYPES = new Set([
  "n8n-nodes-base.executeCommand",
  "n8n-nodes-base.executeWorkflow",
  "n8n-nodes-base.function",
  "n8n-nodes-base.functionItem",
]);
```

Recursively remove keys matching `credentials`, `credential`, `authentication`, `authorization`, `apiKey`, `accessToken`, `refreshToken`, `clientSecret`, `password`, and `privateKey`, case-insensitively. After removal, scan every remaining string for PEM private keys, long bearer tokens, OpenAI-style keys, Slack tokens, Google API keys, and JWT literals. Throw on a match.

Build a set of retained node names. Remove connection source keys not in that set, remove target entries whose `node` is not retained, compact empty arrays, and remove empty source objects. Throw if sanitization leaves no nodes.

- [ ] **Step 4: Run sanitizer, client, and build verification**

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/template-ingestion/template-security.test.ts src/template-ingestion/official-client.test.ts
npm --prefix tools/n8n-knowledge-mcp run build
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 5: Commit sanitizer behavior**

```powershell
git add -- tools/n8n-knowledge-mcp/src/template-ingestion/types.ts tools/n8n-knowledge-mcp/src/template-ingestion/template-security.ts tools/n8n-knowledge-mcp/src/template-ingestion/template-security.test.ts
git commit -m "feat(knowledge): sanitize workflow templates"
```

---

### Task 3: Fetch Staging, Curated Snapshots, and Deterministic Source Merge

**Files:**
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/source-merge.ts`
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/source-merge.test.ts`
- Create: `tools/n8n-knowledge-mcp/scripts/5-fetch-official-templates.ts`
- Create: `tools/n8n-knowledge-mcp/scripts/refresh-curated-templates.ts`
- Create: `tools/n8n-knowledge-mcp/data/curated-templates/manifest.json`
- Create: twelve sanitized JSON snapshots under `tools/n8n-knowledge-mcp/data/curated-templates/`
- Modify: `tools/n8n-knowledge-mcp/package.json`
- Modify: `tools/n8n-knowledge-mcp/package-lock.json`

**Interfaces:**
- Consumes: Task 1 client and Task 2 sanitizer.
- Produces: `.tmp/templates/official/*.json`, `.tmp/templates/official-manifest.json`, and `.tmp/templates/merged/*.json`.
- Produces: `mergeTemplateSources({ official, curated, limit })`.

- [ ] **Step 1: Write failing merge tests**

```ts
import { describe, expect, it } from "vitest";
import { mergeTemplateSources } from "./source-merge.js";

const template = (id: number, source: "official" | "curated", views: number) => ({
  source,
  curated: source === "curated",
  views,
  sourceUrl: `https://n8n.io/workflows/${id}`,
  workflow: { id, name: `Template ${id}`, description: "", totalViews: views, createdAt: null, user: null, workflow: { nodes: [{ id: "n1", name: "Start", type: "n8n-nodes-base.manualTrigger", parameters: {}, position: [0, 0] }], connections: {} } },
});

describe("template source merge", () => {
  it("prefers official bodies for duplicate IDs", () => {
    const result = mergeTemplateSources({ official: [template(1, "official", 10)], curated: [template(1, "curated", 10)], limit: 5_000 });
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("official");
  });

  it("keeps every curated ID while dropping the lowest-view non-curated record", () => {
    const result = mergeTemplateSources({
      official: [template(1, "official", 100), template(2, "official", 90), template(3, "official", 1)],
      curated: [template(4, "curated", 0)],
      limit: 3,
    });
    expect(result.map((item) => item.workflow.id)).toEqual([1, 2, 4]);
  });
});
```

- [ ] **Step 2: Run merge tests to verify RED**

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/template-ingestion/source-merge.test.ts
```

Expected: FAIL because `source-merge.ts` does not exist.

- [ ] **Step 3: Implement the deterministic merge and fetch staging CLI**

Implement the merge as:

```ts
export function mergeTemplateSources(input: {
  official: NormalizedTemplateEnvelope[];
  curated: NormalizedTemplateEnvelope[];
  limit: number;
}): NormalizedTemplateEnvelope[] {
  const curatedIds = new Set(input.curated.map((item) => item.workflow.id));
  const byId = new Map(input.curated.map((item) => [item.workflow.id, item]));
  for (const item of input.official) byId.set(item.workflow.id, item);
  return [...byId.values()]
    .sort((a, b) => Number(curatedIds.has(b.workflow.id)) - Number(curatedIds.has(a.workflow.id)) || b.views - a.views || a.workflow.id - b.workflow.id)
    .slice(0, input.limit)
    .sort((a, b) => a.workflow.id - b.workflow.id);
}
```

The fetch CLI must:

1. remove `.tmp/templates/official` and `.tmp/templates/merged`;
2. collect at most 5,000 summaries;
3. fetch details with the Task 1 client;
4. normalize and sanitize each success;
5. write one JSON file per accepted official template;
6. load and sanitize every curated JSON file listed in the curated manifest;
7. merge sources and write deterministic merged JSON;
8. write the `OfficialFetchManifest` with accepted and rejected counts.

Use atomic temp-file-and-rename writes for every manifest.

- [ ] **Step 4: Add the exact curated manifest and refresh command**

Use this reviewed free-template seed list:

```json
{
  "source": "https://api.n8n.io",
  "templateIds": [1750, 2327, 5171, 584, 1954, 2397, 2089, 2732, 2462, 2859, 3986, 1747]
}
```

Add:

```json
{
  "scripts": {
    "fetch:templates": "tsx scripts/5-fetch-official-templates.ts",
    "refresh:curated": "tsx scripts/refresh-curated-templates.ts"
  }
}
```

Run the refresh command once. It must fetch only manifest IDs, normalize and sanitize them, and overwrite the twelve tracked snapshots. Review generated files with both scans:

```powershell
npm --prefix tools/n8n-knowledge-mcp run refresh:curated
rg -n -i "credentials|authorization|accessToken|refreshToken|clientSecret|private key|sk-|xoxb-" tools/n8n-knowledge-mcp/data/curated-templates --glob '*.json'
rg -n -e 'n8n-nodes-base.executeCommand' -e 'n8n-nodes-base.function(Item)?' tools/n8n-knowledge-mcp/data/curated-templates --glob '*.json'
```

Expected: twelve snapshot files are produced; both security scans have no matches outside descriptive template text. If descriptive text matches, the sanitizer test must prove it is not inside the stored workflow body before committing.

- [ ] **Step 5: Run merge and security tests**

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/template-ingestion/source-merge.test.ts src/template-ingestion/template-security.test.ts src/template-ingestion/official-client.test.ts
npm --prefix tools/n8n-knowledge-mcp run build
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit staging and curated snapshots**

```powershell
git add -- tools/n8n-knowledge-mcp/src/template-ingestion/source-merge.ts tools/n8n-knowledge-mcp/src/template-ingestion/source-merge.test.ts tools/n8n-knowledge-mcp/scripts/5-fetch-official-templates.ts tools/n8n-knowledge-mcp/scripts/refresh-curated-templates.ts tools/n8n-knowledge-mcp/data/curated-templates tools/n8n-knowledge-mcp/package.json tools/n8n-knowledge-mcp/package-lock.json
git commit -m "feat(knowledge): stage official and curated templates"
```

---

### Task 4: Network-Free SQLite Import and Knowledge Quality Gate

**Files:**
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/template-importer.ts`
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/template-importer.test.ts`
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/quality-gate.ts`
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/quality-gate.test.ts`
- Create: `tools/n8n-knowledge-mcp/scripts/9-verify-knowledge-db.ts`
- Modify: `tools/n8n-knowledge-mcp/scripts/5-build-templates.ts`
- Modify: `tools/n8n-knowledge-mcp/scripts/6-emit-stats.ts`
- Modify: `tools/n8n-knowledge-mcp/src/db.ts`
- Modify: `tools/n8n-knowledge-mcp/src/server-health.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/tools/index.ts`
- Create: `tools/n8n-knowledge-mcp/src/template-ingestion/template-tools.test.ts`
- Modify: `tools/n8n-knowledge-mcp/package.json`
- Modify: `tools/n8n-knowledge-mcp/package-lock.json`

**Interfaces:**
- Consumes: `.tmp/templates/merged` and the official/curated manifests from Task 3.
- Produces: `importTemplates({ dbPath, sourceDir })`.
- Produces: `verifyKnowledgeDb(input): KnowledgeQualityReport` and `data/knowledge-quality-report.json`.
- Extends authenticated `/health` statistics with `templates`.

- [ ] **Step 1: Write failing importer and quality-gate tests**

Use a temporary SQLite database with the same `templates` and `templates_fts` schema as `4-build-db.ts`:

```ts
it("imports normalized templates and keeps FTS row parity", async () => {
  const result = await importTemplates({ dbPath, sourceDir });
  expect(result).toEqual({ imported: 2, skipped: 0 });
  expect(db.prepare("SELECT COUNT(*) count FROM templates").get()).toEqual({ count: 2 });
  expect(db.prepare("SELECT COUNT(*) count FROM templates_fts").get()).toEqual({ count: 2 });
});

it("fails when fewer than 95 percent of the official target were accepted", () => {
  expect(() => verifyKnowledgeDb({
    dbPath,
    manifest: { source: "https://api.n8n.io", totalWorkflows: 5_100, target: 5_000, summaryCount: 5_000, detailSuccessCount: 5_000, detailFailureCount: 0, failedIds: [], acceptedCount: 4_749, rejectedCount: 251, rejectedIds: [], generatedAt: new Date().toISOString() },
    curatedIds: [1750],
    mode: "official",
  })).toThrow(/4750/);
});

it("fails when templates and FTS counts differ or a connection is stale", () => {
  db.prepare("DELETE FROM templates_fts WHERE rowid = 1").run();
  expect(() => verifyKnowledgeDb(validOfficialInput)).toThrow(/FTS/i);
});
```

Add tests for duplicate IDs, missing curated IDs, more than 5,000 rows, prohibited nodes, secret patterns, empty workflows, and stale connection targets.

- [ ] **Step 2: Run importer and gate tests to verify RED**

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/template-ingestion/template-importer.test.ts src/template-ingestion/quality-gate.test.ts
```

Expected: FAIL because importer and quality-gate modules do not exist.

- [ ] **Step 3: Extract the importer and make the existing script a thin CLI**

Move normalization-independent SQLite insertion from `scripts/5-build-templates.ts` into:

```ts
export async function importTemplates(input: {
  dbPath: string;
  sourceDir: string;
}): Promise<{ imported: number; skipped: number }>;
```

The importer reads only already normalized envelopes, deletes prior `templates` and `templates_fts` rows inside one SQLite transaction, inserts templates and FTS rows, and rolls back the transaction on any invalid envelope. It never catches and skips invalid JSON silently.

Make `scripts/5-build-templates.ts` resolve `DB_PATH` and `TEMPLATES_DIR`, call `importTemplates`, print the result, and exit non-zero on error.

- [ ] **Step 4: Implement the quality gate and report**

Define:

```ts
export type KnowledgeQualityReport = {
  mode: "official" | "fallback";
  ok: boolean;
  sourceTotal: number;
  sourceTarget: number;
  acceptedOfficial: number;
  rejectedOfficial: number;
  templateCount: number;
  ftsCount: number;
  curatedRequired: number;
  curatedPresent: number;
  errors: string[];
  generatedAt: string;
};
```

`verifyKnowledgeDb` must collect all errors, write no report itself, and throw an error containing the list when `mode === "official"` and any gate fails. Fallback mode requires every curated ID, a non-empty database, FTS parity, safe workflows, and valid connections, but does not require official completeness.

The CLI accepts exactly `--mode=official` or `--mode=fallback`. Official mode requires `.tmp/templates/official-manifest.json`; fallback mode permits it to be absent and records all official source counts as zero. Both modes require `data/curated-templates/manifest.json`. The CLI writes the report atomically to `data/knowledge-quality-report.json`, prints a single summary line, and exits 1 when `ok` is false.

- [ ] **Step 5: Add template counts to stats and authenticated health**

Extend `statsCount()`:

```ts
templates: safeCount("SELECT COUNT(*) c FROM templates"),
```

Extend `scripts/6-emit-stats.ts` to emit `templates` and copy the same value to the root `src/data/n8n-stats.json`. Update the health test so anonymous `/health` still returns only `{ ok: true }`, while an authenticated request includes `templates`.

- [ ] **Step 6: Make template tool handlers directly testable**

Extract and export the same functions used by MCP registration:

```ts
export function searchWorkflowTemplates(input: { query: string; limit?: number }) {
  const limit = input.limit ?? 10;
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.description, t.views, t.node_count
         FROM templates_fts f JOIN templates t ON t.id = f.rowid
        WHERE templates_fts MATCH ?
        ORDER BY rank, t.views DESC LIMIT ?`,
    )
    .all(ftsEscape(input.query), limit);
  return { count: rows.length, templates: rows };
}

export function getWorkflowTemplateById(id: number) {
  const row = db.prepare("SELECT * FROM templates WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    categories: JSON.parse(String(row.categories_json || "[]")),
    node_types: JSON.parse(String(row.node_types_json || "[]")),
    author: { name: row.author_name, username: row.author_username, avatar: row.author_avatar },
    views: row.views,
    node_count: row.node_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    source_url: row.source_url,
    workflow: row.workflow_json ? JSON.parse(String(row.workflow_json)) : null,
  };
}
```

Register `search_templates` and `get_workflow_template` by calling these functions. Add an integration test against the temporary imported database and assert a real match plus parseable sanitized workflow JSON.

- [ ] **Step 7: Run focused and full Knowledge MCP tests**

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/template-ingestion src/server-health.test.ts
npm --prefix tools/n8n-knowledge-mcp exec vitest run
npm --prefix tools/n8n-knowledge-mcp run build
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 8: Commit importer and gate**

```powershell
git add -- tools/n8n-knowledge-mcp/src/template-ingestion tools/n8n-knowledge-mcp/scripts/5-build-templates.ts tools/n8n-knowledge-mcp/scripts/6-emit-stats.ts tools/n8n-knowledge-mcp/scripts/9-verify-knowledge-db.ts tools/n8n-knowledge-mcp/src/db.ts tools/n8n-knowledge-mcp/src/server-health.test.ts tools/n8n-knowledge-mcp/src/tools/index.ts tools/n8n-knowledge-mcp/package.json tools/n8n-knowledge-mcp/package-lock.json
git commit -m "feat(knowledge): gate template database quality"
```

---

### Task 5: Build the Database Once and Package the Verified Artifact

**Files:**
- Create: `tools/n8n-knowledge-mcp/.dockerignore`
- Modify: `tools/n8n-knowledge-mcp/Dockerfile`
- Modify: `tools/n8n-knowledge-mcp/package.json`
- Modify: `tools/n8n-knowledge-mcp/package-lock.json`
- Create: `tools/n8n-knowledge-mcp/src/build-artifact-contract.test.ts`

**Interfaces:**
- Consumes: verified `data/nodes.db`, `data/stats.json`, and `data/knowledge-quality-report.json` from Task 4.
- Produces: a runtime image that contains those exact files and never fetches knowledge during `docker build`.

- [ ] **Step 1: Write the failing Docker/build contract test**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("verified knowledge image contract", () => {
  const dockerfile = readFileSync(resolve(process.cwd(), "Dockerfile"), "utf8");
  const pkg = JSON.parse(readFileSync(resolve(process.cwd(), "package.json"), "utf8"));

  it("copies a prebuilt database and never rebuilds it in Docker", () => {
    expect(dockerfile).toContain("COPY data/nodes.db ./data/nodes.db");
    expect(dockerfile).toContain("COPY data/knowledge-quality-report.json ./data/knowledge-quality-report.json");
    expect(dockerfile).not.toContain("RUN npm run build:db");
    expect(dockerfile).toContain('CMD ["node", "dist/src/server.js"]');
    expect(pkg.scripts.start).toBe("node dist/src/server.js");
    expect(pkg.scripts["build:knowledge"]).toContain("fetch:templates");
    expect(pkg.scripts["build:knowledge"]).toContain("verify:knowledge");
  });
});
```

- [ ] **Step 2: Run the contract test to verify RED**

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/build-artifact-contract.test.ts
```

Expected: FAIL because Docker still rebuilds knowledge and the orchestration script does not exist.

- [ ] **Step 3: Add exact build scripts**

Set package scripts to:

```json
{
  "build:nodes": "tsx scripts/1-fetch-packages.ts && tsx scripts/2-parse-nodes.ts && tsx scripts/3-parse-docs.ts && tsx scripts/4-build-db.ts",
  "fetch:templates": "tsx scripts/5-fetch-official-templates.ts",
  "build:templates": "tsx scripts/5-build-templates.ts",
  "emit:stats": "tsx scripts/6-emit-stats.ts",
  "verify:knowledge": "tsx scripts/9-verify-knowledge-db.ts --mode=official",
  "verify:knowledge:fallback": "tsx scripts/9-verify-knowledge-db.ts --mode=fallback",
  "build:knowledge": "npm run build:nodes && npm run fetch:templates && npm run build:templates && npm run emit:stats && npm run verify:knowledge",
  "start": "node dist/src/server.js"
}
```

Retain existing external-candidate scripts as separate opt-in commands. Do not make them a requirement for the official production build.

- [ ] **Step 4: Make Docker consume the verified artifact**

Create `.dockerignore`:

```text
node_modules
dist
.tmp
data/curated-templates
data/nodes.db-shm
data/nodes.db-wal
*.log
```

Modify the Dockerfile so the build stage compiles TypeScript but does not access the network for knowledge:

```dockerfile
FROM deps AS build
WORKDIR /app
COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && useradd -r -u 1001 -g nogroup app
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY data/nodes.db ./data/nodes.db
COPY data/stats.json ./data/stats.json
COPY data/knowledge-quality-report.json ./data/knowledge-quality-report.json
USER app
ENV PORT=3000 DB_PATH=/app/data/nodes.db
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/src/server.js"]
```

- [ ] **Step 5: Verify contract, build, and local image smoke test**

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/build-artifact-contract.test.ts
npm --prefix tools/n8n-knowledge-mcp run build
docker build -t n8n-knowledge-mcp:verified tools/n8n-knowledge-mcp
docker run --rm -d --name n8n-knowledge-mcp-verify -e AUTH_TOKEN=test-token -p 127.0.0.1:39000:3000 n8n-knowledge-mcp:verified
curl.exe -fsS -H "Authorization: Bearer test-token" http://127.0.0.1:39000/health
docker stop n8n-knowledge-mcp-verify
```

Expected: contract and build PASS; authenticated health returns `ok: true` and a positive `templates` count.

- [ ] **Step 6: Commit single-build packaging**

```powershell
git add -- tools/n8n-knowledge-mcp/.dockerignore tools/n8n-knowledge-mcp/Dockerfile tools/n8n-knowledge-mcp/package.json tools/n8n-knowledge-mcp/package-lock.json tools/n8n-knowledge-mcp/src/build-artifact-contract.test.ts
git commit -m "build(knowledge): package verified database once"
```

---

### Task 6: Atomic GitHub Publication and VPS Deployment with Rollback

**Files:**
- Create: `deploy/update-knowledge.sh`
- Create: `tools/n8n-knowledge-mcp/src/deployment-contract.test.ts`
- Modify: `.github/workflows/n8n-knowledge-mcp.yml`
- Modify: `deploy/.env.example`
- Modify: `deploy/README.md`

**Interfaces:**
- Consumes: Task 5 verified image and Task 4 report.
- Produces: immutable GHCR tag, `latest` at the same digest, and `deploy/update-knowledge.sh <tag> <expected-template-count>`.
- Requires GitHub Secrets: `VPS_HOST`, `VPS_PORT`, `VPS_USER`, `VPS_SSH_KEY`, `VPS_KNOWN_HOSTS`, `DEPLOY_PATH`.

- [ ] **Step 1: Write failing workflow and deployment contract tests**

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("knowledge publication and deployment contracts", () => {
  const workflow = readFileSync(resolve(process.cwd(), "../../.github/workflows/n8n-knowledge-mcp.yml"), "utf8");
  const deploy = readFileSync(resolve(process.cwd(), "../../deploy/update-knowledge.sh"), "utf8");

  it("keeps weekly and manual triggers and gates latest/deploy on verification", () => {
    expect(workflow).toContain('cron: "0 2 * * 1"');
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain("knowledge-quality-report.json");
    expect(workflow).toContain("degraded-knowledge-fallback");
    expect(workflow).toMatch(/smoke[\\s\\S]*latest/);
    expect(workflow).toContain("VPS_KNOWN_HOSTS");
  });

  it("preserves the old tag and rolls back only the mcp service", () => {
    expect(deploy).toContain('OLD_TAG=');
    expect(deploy).toContain("rollback");
    expect(deploy).toContain("docker compose up -d --no-deps mcp");
    expect(deploy).not.toContain("caddy");
    expect(deploy).not.toContain(" app");
  });
});
```

- [ ] **Step 2: Run the contract test to verify RED**

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/deployment-contract.test.ts
```

Expected: FAIL because `deploy/update-knowledge.sh` does not exist and the workflow is not gated.

- [ ] **Step 3: Implement the remote deployment script**

The script contract is:

```bash
#!/usr/bin/env bash
set -Eeuo pipefail

NEW_TAG="${1:?usage: update-knowledge.sh <tag> <expected-template-count>}"
EXPECTED_TEMPLATES="${2:?usage: update-knowledge.sh <tag> <expected-template-count>}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

[[ "$NEW_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid image tag" >&2; exit 2; }
[[ "$EXPECTED_TEMPLATES" =~ ^[0-9]+$ ]] || { echo "invalid template count" >&2; exit 2; }

OLD_TAG="$(grep -E '^MCP_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
GHCR_OWNER="$(grep -E '^GHCR_OWNER=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
IMAGE="ghcr.io/${GHCR_OWNER}/n8n-knowledge-mcp"
ROLLING_BACK=0
```

Implement `set_tag` with `mktemp`, `awk`, `mv`, and a `.bak` copy. Implement `wait_for_health(tag, expected)` by polling Docker health for at most 120 seconds, then running a Node command inside `n8n-knowledge-mcp` that calls authenticated `/health` using the container's `AUTH_TOKEN` and verifies `templates === expected`.

Register an `ERR` trap only after `OLD_TAG` is known. The trap sets `ROLLING_BACK=1`, restores `OLD_TAG`, runs `docker compose -f "$COMPOSE_FILE" up -d --no-deps mcp`, verifies rollback health without enforcing the new count, and exits non-zero. The success path pulls `IMAGE:NEW_TAG`, persists the tag, recreates only `mcp`, verifies the expected count, and removes the backup.

- [ ] **Step 4: Rewrite the workflow as a gated single-snapshot pipeline**

Keep the existing triggers. Implement these ordered steps:

1. checkout and Node 22 setup;
2. `npm ci`;
3. `npm run build:nodes`;
4. live `npm run fetch:templates` with `continue-on-error: true` and an output recording success;
5. on official success: build templates, emit stats, and verify official quality;
6. on official failure: copy curated templates to merged staging, build templates, emit stats, verify fallback mode, and upload `data/nodes.db`, `data/stats.json`, and `data/knowledge-quality-report.json` as artifact `degraded-knowledge-fallback`;
7. explicitly fail after the fallback artifact is uploaded;
8. on official success: build and load a local Linux image tagged `knowledge-local:<run-id>`;
9. run the image and verify authenticated health count equals the quality report;
10. login to GHCR and push `YYYYMMDD-<run-id>`;
11. tag the same local image as `latest` and push it;
12. update the statistics PR from the verified database;
13. create `~/.ssh/id_ed25519` and `known_hosts` from secrets with restrictive permissions;
14. copy `deploy/update-knowledge.sh` to `${DEPLOY_PATH}` and run it over SSH with the immutable tag and expected template count.

Never use `StrictHostKeyChecking=no`. Do not put the SSH key, MCP token, workflow body, or raw API response in logs.

Use these exact guards for the official and fallback branches:

```yaml
- name: Fetch official templates
  id: official
  continue-on-error: true
  run: npm run fetch:templates

- name: Build and verify official template database
  if: steps.official.outcome == 'success'
  run: |
    npm run build:templates
    npm run emit:stats
    npm run verify:knowledge

- name: Build curated fallback database
  if: steps.official.outcome != 'success'
  run: |
    rm -rf .tmp/templates/merged
    mkdir -p .tmp/templates/merged
    find data/curated-templates -maxdepth 1 -type f -name '*.json' ! -name 'manifest.json' -exec cp '{}' .tmp/templates/merged/ \;
    npm run build:templates
    npm run emit:stats
    npm run verify:knowledge:fallback

- name: Upload degraded fallback
  if: steps.official.outcome != 'success'
  uses: actions/upload-artifact@v4
  with:
    name: degraded-knowledge-fallback
    path: |
      tools/n8n-knowledge-mcp/data/nodes.db
      tools/n8n-knowledge-mcp/data/stats.json
      tools/n8n-knowledge-mcp/data/knowledge-quality-report.json

- name: Stop after degraded fallback
  if: steps.official.outcome != 'success'
  run: exit 1
```

Use the verified report to define publication and deployment values:

```bash
EXPECTED_TEMPLATES="$(node -e "const r=require('./data/knowledge-quality-report.json'); process.stdout.write(String(r.templateCount))")"
IMMUTABLE_TAG="$(date -u +%Y%m%d)-${GITHUB_RUN_ID}"
docker tag "knowledge-local:${GITHUB_RUN_ID}" "ghcr.io/${GITHUB_REPOSITORY_OWNER}/n8n-knowledge-mcp:${IMMUTABLE_TAG}"
docker push "ghcr.io/${GITHUB_REPOSITORY_OWNER}/n8n-knowledge-mcp:${IMMUTABLE_TAG}"
docker tag "knowledge-local:${GITHUB_RUN_ID}" "ghcr.io/${GITHUB_REPOSITORY_OWNER}/n8n-knowledge-mcp:latest"
docker push "ghcr.io/${GITHUB_REPOSITORY_OWNER}/n8n-knowledge-mcp:latest"
scp -P "${VPS_PORT}" ../../deploy/update-knowledge.sh "${VPS_USER}@${VPS_HOST}:${DEPLOY_PATH}/update-knowledge.sh"
ssh -p "${VPS_PORT}" "${VPS_USER}@${VPS_HOST}" "cd '${DEPLOY_PATH}' && chmod 700 update-knowledge.sh && ./update-knowledge.sh '${IMMUTABLE_TAG}' '${EXPECTED_TEMPLATES}'"
```

- [ ] **Step 5: Document production secrets and immutable tag persistence**

Add `MCP_IMAGE_TAG=latest` to `deploy/.env.example` if absent. Document all six secrets, required Docker permissions, `DEPLOY_PATH`, the weekly schedule, fallback artifact behavior, and the manual dispatch procedure in `deploy/README.md`.

- [ ] **Step 6: Verify workflow, shell syntax, and tests**

Run locally:

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run src/deployment-contract.test.ts
npm --prefix tools/n8n-knowledge-mcp exec vitest run
npm --prefix tools/n8n-knowledge-mcp run build
```

Run on an Ubuntu runner or GitHub Actions before merge:

```bash
bash -n deploy/update-knowledge.sh
```

Expected: all tests PASS, TypeScript exits 0, and Bash syntax exits 0.

- [ ] **Step 7: Commit publication and deployment**

```powershell
git add -- .github/workflows/n8n-knowledge-mcp.yml deploy/update-knowledge.sh deploy/.env.example deploy/README.md tools/n8n-knowledge-mcp/src/deployment-contract.test.ts
git commit -m "ci(knowledge): deploy verified weekly refreshes"
```

---

### Task 7: Documentation, Full Regression, and Release Readiness

**Files:**
- Modify: `tools/n8n-knowledge-mcp/README.md`
- Modify: `src/data/n8n-stats.json` only through the verified build command
- Modify: active files returned by final scans only

**Interfaces:**
- Produces: verified repository and operational handoff.

- [ ] **Step 1: Update Knowledge MCP documentation**

Document:

- official API endpoints and the 5,000/95% rules;
- curated manifest IDs and refresh command;
- staging directories and network-free importer boundary;
- `build:knowledge`, fallback build, and quality report commands;
- authenticated health template counts;
- the fact that external candidates remain opt-in and separate;
- weekly/manual rebuild and VPS rollback behavior.

- [ ] **Step 2: Run the complete Knowledge MCP verification**

```powershell
npm --prefix tools/n8n-knowledge-mcp exec vitest run
npm --prefix tools/n8n-knowledge-mcp run build
npm --prefix tools/n8n-knowledge-mcp run build:knowledge
```

Expected: all tests and TypeScript PASS; live build accepts at least 4,750 official templates when the API advertises at least 5,000, creates at most 5,000 final templates, and produces an `ok: true` report.

- [ ] **Step 3: Inspect the generated database with Python SQLite**

```powershell
python -c "import json,sqlite3; db=sqlite3.connect(r'tools/n8n-knowledge-mcp/data/nodes.db'); t=db.execute('select count(*) from templates').fetchone()[0]; f=db.execute('select count(*) from templates_fts').fetchone()[0]; assert 4750 <= t <= 5000 and t == f, (t,f); r=json.load(open(r'tools/n8n-knowledge-mcp/data/knowledge-quality-report.json',encoding='utf-8')); assert r['ok'] is True; print({'templates':t,'fts':f,'acceptedOfficial':r['acceptedOfficial']})"
```

Expected: prints matching template/FTS counts between 4,750 and 5,000.

- [ ] **Step 4: Run root and Express regressions**

```powershell
npm test -- --run
npm run type-check
npm run lint
npm run build
npm test --workspace @n8nmcp/api -- --run
npm run type-check --workspace @n8nmcp/api
npm run build --workspace @n8nmcp/api
```

Expected: every command exits 0.

- [ ] **Step 5: Run security, forbidden-value, and diff scans**

```powershell
rg -n -i "credentials|authorization|accessToken|refreshToken|clientSecret|private key|sk-|xoxb-" tools/n8n-knowledge-mcp/data/curated-templates --glob '*.json'
rg -n -e 'n8n-nodes-base.executeCommand' -e 'n8n-nodes-base.function(Item)?' tools/n8n-knowledge-mcp/data/curated-templates --glob '*.json'
rg -n -F -e 'StrictHostKeyChecking=no' .github deploy
git diff --check
git status --short
git diff --stat
```

Expected: no workflow-body secret or prohibited-node matches, no disabled SSH host checking, diff check exits 0, and status contains only intended task changes plus preserved pre-existing user changes.

- [ ] **Step 6: Commit final documentation and generated statistics**

```powershell
git add -- tools/n8n-knowledge-mcp/README.md src/data/n8n-stats.json
git commit -m "docs(knowledge): document template refresh operations"
```

- [ ] **Step 7: Check completion criteria against fresh evidence**

Confirm all of the following from command output rather than inference:

- official staging is deterministic and capped;
- at least 95% of the official target is accepted;
- every curated ID is present;
- final and FTS counts match and do not exceed 5,000;
- stored workflow bodies contain no credentials, recognized secrets, prohibited nodes, or stale connections;
- Docker packages the verified database without rebuilding it;
- smoke test precedes GHCR publication;
- official failure cannot update `latest` or deploy;
- VPS deploy uses the immutable tag, strict known hosts, health count verification, and automatic rollback;
- weekly and manual triggers exist;
- Knowledge MCP, root, and Express verifications pass.
