import type { NormalizedTemplateEnvelope } from "./types.js";

export function mergeTemplateSources(input: {
  official: NormalizedTemplateEnvelope[];
  curated: NormalizedTemplateEnvelope[];
  limit: number;
}): NormalizedTemplateEnvelope[] {
  const curatedIds = new Set(input.curated.map((item) => item.workflow.id));
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
