# Reject Duplicate Template Node Names Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reject official template details with ambiguous duplicate retained node names during normalization so they are counted as rejected templates instead of failing the completed database quality gate.

**Architecture:** Keep the database quality rule as defense in depth, but enforce the same invariant at the per-template normalization boundary where `stageOfficialTemplates()` already catches invalid details and records their IDs in `rejectedIds`. Validate exact retained node names after prohibited nodes are removed and before name-keyed connections are sanitized; never rename nodes or guess which duplicate a connection targets.

**Tech Stack:** TypeScript, Node.js 20, Vitest.

## Global Constraints

- Duplicate retained node names are invalid because n8n connections address nodes by name.
- Reject the entire template when two retained nodes have the same exact `name` string.
- Do not auto-rename, de-duplicate, remove, or merge duplicate nodes, and do not rewrite connection source or target names.
- Perform duplicate validation after prohibited node types are filtered, so a removed prohibited node cannot create a false duplicate among retained nodes.
- `stageOfficialTemplates()` must count duplicate-name details in `rejectedCount`/`rejectedIds` and must not write them to the official or merged template set.
- Keep `validateStoredWorkflow()` duplicate-name validation unchanged as defense in depth.
- Keep the 95% official acceptance threshold and all manifest arithmetic unchanged.
- Do not change the official HTTP client, schema, template importer, database schema, package dependencies, or release workflow.
- Tests and TypeScript checks run under Node 20.
- Do not download templates, generate databases, build images, publish GHCR tags, or deploy VPS state in this code task.

---

### Task 9: Reject Duplicate Names at Template Normalization

**Files:**
- Modify: `tools/n8n-knowledge-mcp/src/template-ingestion/template-security.ts`
- Modify: `tools/n8n-knowledge-mcp/src/template-ingestion/template-security.test.ts`
- Modify: `tools/n8n-knowledge-mcp/src/template-ingestion/template-publication.test.ts`

**Interfaces:**
- Consumes: `normalizeAndSanitizeTemplate(detail, summary?)` with an official workflow whose connections use node names.
- Produces: the existing `NormalizedTemplateEnvelope` when all retained node names are unique.
- Produces: `Error("Workflow contains duplicate node name <name>")` when a retained name repeats.
- Relies on: the existing `stageOfficialTemplates()` per-detail catch to append that detail ID to `rejectedIds`.

- [ ] **Step 1: Write the failing normalization test**

Add this behavior to `src/template-ingestion/template-security.test.ts`:

```ts
it("rejects duplicate retained node names instead of guessing connection ownership", () => {
  expect(() => normalizeAndSanitizeTemplate({
    id: 636,
    name: "Ambiguous duplicate",
    workflow: {
      nodes: [
        { id: "a", name: "GS Read Data2", type: "n8n-nodes-base.googleSheets", parameters: {}, position: [0, 0] },
        { id: "b", name: "GS Read Data2", type: "n8n-nodes-base.googleSheets", parameters: {}, position: [200, 0] },
      ],
      connections: {
        "GS Read Data2": {
          main: [[{ node: "GS Read Data2", type: "main", index: 0 }]],
        },
      },
    },
  })).toThrow("Workflow contains duplicate node name GS Read Data2");
});
```

Also add a guard proving validation happens after prohibited-node filtering:

```ts
it("does not treat a removed prohibited node as a retained-name duplicate", () => {
  const result = normalizeAndSanitizeTemplate({
    id: 637,
    name: "Removed duplicate",
    workflow: {
      nodes: [
        { id: "safe", name: "Step", type: "n8n-nodes-base.noOp", parameters: {}, position: [0, 0] },
        { id: "removed", name: "Step", type: "n8n-nodes-base.executeCommand", parameters: {}, position: [200, 0] },
      ],
      connections: {},
    },
  });

  expect(result.workflow.workflow.nodes.map((node) => node.id)).toEqual(["safe"]);
});
```

- [ ] **Step 2: Write the failing publication accounting test**

Add a test to `src/template-ingestion/template-publication.test.ts` that stages IDs 1 and 2 with the existing temporary real filesystem. Override only `fetchDetails` so ID 1 uses `detail(1)` and ID 2 has two retained nodes named `Duplicate` with a name-keyed self-connection.

Assert:

```ts
expect(manifest).toMatchObject({
  detailSuccessCount: 2,
  acceptedCount: 1,
  rejectedCount: 1,
  rejectedIds: [2],
});
expect(await readdir(join(targetDirectory, "official"))).toEqual(["1.json"]);
expect(await readdir(join(targetDirectory, "merged"))).not.toContain("2.json");
```

Use a curated ID other than 1 or 2 so source merge precedence does not affect the assertion.

- [ ] **Step 3: Run the focused tests and verify RED**

```powershell
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run src/template-ingestion/template-security.test.ts src/template-ingestion/template-publication.test.ts --maxWorkers=1
```

Expected: the new duplicate-name normalization test fails because no error is thrown, and the publication test reports `acceptedCount: 2`/`rejectedCount: 0`. The prohibited-node ordering guard must already pass. Confirm there are no fixture, syntax, or unrelated failures.

- [ ] **Step 4: Implement the minimal retained-name validation**

In `sanitizeNodes()` in `src/template-ingestion/template-security.ts`, add one `Set<string>` for retained names. After the existing name/type validation and before `retained.push(node)`, enforce:

```ts
const retainedNodeNames = new Set<string>();

// inside the loop, after prohibited-node filtering and existing shape validation
if (retainedNodeNames.has(node.name)) {
  throw new Error(`Workflow contains duplicate node name ${node.name}`);
}
retainedNodeNames.add(node.name);
retained.push(node);
```

Do not change `normalizeAndSanitizeTemplate()`, `sanitizeConnections()`, `stageOfficialTemplates()`, or `validateStoredWorkflow()`; their existing control flow supplies rejection accounting, connection safety, and defense in depth.

- [ ] **Step 5: Verify GREEN and regression safety**

```powershell
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run src/template-ingestion/template-security.test.ts src/template-ingestion/template-publication.test.ts --maxWorkers=1
npx.cmd --yes node@20 ./node_modules/vitest/vitest.mjs run --maxWorkers=1
npx.cmd --yes node@20 ./node_modules/typescript/bin/tsc -p tsconfig.json
git diff --check
```

Expected: focused and complete tests have zero failures; TypeScript and diff check exit 0. No network, template download, database generation, image build, or artifact synchronization is required.

- [ ] **Step 6: Commit**

```powershell
git add -- tools/n8n-knowledge-mcp/src/template-ingestion/template-security.ts tools/n8n-knowledge-mcp/src/template-ingestion/template-security.test.ts tools/n8n-knowledge-mcp/src/template-ingestion/template-publication.test.ts
git commit -m "fix(knowledge): reject ambiguous template nodes"
```
