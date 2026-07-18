import type { NormalizedTemplateEnvelope } from "./types.js";

export function mergeTemplateSources(input: {
  official: NormalizedTemplateEnvelope[];
  curated: NormalizedTemplateEnvelope[];
  limit: number;
}): NormalizedTemplateEnvelope[] {
  const curatedIds = new Set(input.curated.map((item) => item.workflow.id));
  if (!Number.isFinite(input.limit) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 5_000) {
    throw new RangeError("Template merge limit must be an integer between 1 and 5,000");
  }
  if (input.limit < curatedIds.size) {
    throw new RangeError("Template merge limit cannot be smaller than the unique curated ID count");
  }
  const byId = new Map(input.curated.map((item) => [item.workflow.id, item]));
  for (const item of input.official) byId.set(item.workflow.id, item);
  return [...byId.values()]
    .sort(
      (a, b) =>
        Number(curatedIds.has(b.workflow.id)) - Number(curatedIds.has(a.workflow.id)) ||
        b.views - a.views ||
        a.workflow.id - b.workflow.id,
    )
    .slice(0, input.limit)
    .sort((a, b) => a.workflow.id - b.workflow.id);
}
