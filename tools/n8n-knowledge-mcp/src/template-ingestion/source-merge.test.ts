import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { mergeTemplateSources } from "./source-merge.js";
import type { NormalizedTemplateEnvelope } from "./types.js";

const template = (id: number, source: "official" | "curated", views: number) => ({
  source,
  curated: source === "curated",
  views,
  sourceUrl: `https://n8n.io/workflows/${id}`,
  workflow: {
    id,
    name: `Template ${id}`,
    description: "",
    totalViews: views,
    createdAt: null,
    user: null,
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
  },
});

describe("template source merge", () => {
  it("prefers official bodies for duplicate IDs", () => {
    const result = mergeTemplateSources({
      official: [template(1, "official", 10)],
      curated: [template(1, "curated", 10)],
      limit: 5_000,
    });
    expect(result).toHaveLength(1);
    expect(result[0]?.source).toBe("official");
  });

  it("keeps every curated ID while dropping the lowest-view non-curated record", () => {
    const result = mergeTemplateSources({
      official: [
        template(1, "official", 100),
        template(2, "official", 90),
        template(3, "official", 1),
      ],
      curated: [template(4, "curated", 0)],
      limit: 3,
    });
    expect(result.map((item) => item.workflow.id)).toEqual([1, 2, 4]);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 5_001])(
    "rejects invalid limit %s",
    (limit) => {
      expect(() =>
        mergeTemplateSources({
          official: [template(1, "official", 10)],
          curated: [],
          limit,
        }),
      ).toThrow(/limit/i);
    },
  );

  it("rejects a limit smaller than the number of unique curated IDs", () => {
    expect(() =>
      mergeTemplateSources({
        official: [],
        curated: [template(1, "curated", 10), template(2, "curated", 9)],
        limit: 1,
      }),
    ).toThrow(/curated|limit/i);
  });

  it("counts duplicate curated IDs only once when enforcing the limit", () => {
    const result = mergeTemplateSources({
      official: [],
      curated: [template(1, "curated", 10), template(1, "curated", 9)],
      limit: 1,
    });

    expect(result.map((item) => item.workflow.id)).toEqual([1]);
  });
});

describe("curated template snapshots", () => {
  it("confines scan terms to non-executable sticky-note descriptions", async () => {
    const directory = fileURLToPath(new URL("../../data/curated-templates/", import.meta.url));
    const manifest = JSON.parse(await readFile(`${directory}/manifest.json`, "utf8")) as {
      templateIds: number[];
    };
    const snapshotFiles = (await readdir(directory))
      .filter((name) => name !== "manifest.json" && name.endsWith(".json"))
      .sort((a, b) => Number.parseInt(a) - Number.parseInt(b));
    expect(snapshotFiles).toEqual(
      [...manifest.templateIds]
        .sort((a, b) => a - b)
        .map((id) => `${id}.json`),
    );
    expect(snapshotFiles).toHaveLength(12);

    const sensitiveTerms =
      /credentials|authorization|accessToken|refreshToken|clientSecret|private key|sk-|xoxb-/i;
    const prohibitedNodeTypes =
      /n8n-nodes-base\.executeCommand|n8n-nodes-base\.function(?:Item)?/i;
    let descriptiveMatchCount = 0;

    for (const file of snapshotFiles) {
      const snapshot = JSON.parse(
        await readFile(`${directory}/${file}`, "utf8"),
      ) as NormalizedTemplateEnvelope;
      const withoutDescriptions = structuredClone(snapshot);
      const executableNodes = withoutDescriptions.workflow.workflow.nodes.filter(
        (node) => node.type !== "n8n-nodes-base.stickyNote",
      );

      for (const node of withoutDescriptions.workflow.workflow.nodes) {
        if (node.type !== "n8n-nodes-base.stickyNote") continue;
        const parameters = node.parameters;
        if (typeof parameters !== "object" || parameters === null || Array.isArray(parameters)) {
          continue;
        }
        if (!("content" in parameters)) continue;
        if (typeof parameters.content === "string" && sensitiveTerms.test(parameters.content)) {
          descriptiveMatchCount += 1;
        }
        parameters.content = "";
      }

      expect(JSON.stringify(executableNodes)).not.toMatch(sensitiveTerms);
      expect(JSON.stringify(withoutDescriptions)).not.toMatch(sensitiveTerms);
      expect(JSON.stringify(snapshot)).not.toMatch(prohibitedNodeTypes);
    }

    expect(descriptiveMatchCount).toBe(2);
  });
});
