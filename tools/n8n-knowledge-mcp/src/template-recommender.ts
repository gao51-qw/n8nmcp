export type IntentProfile = {
  normalizedIntent: string;
  systems: string[];
  domains: string[];
  nodeTypes: string[];
  triggerTypes: string[];
  patternTypes: string[];
  keywords: string[];
};

export type TemplateCandidate = {
  id: number;
  name: string;
  description?: string | null;
  categories_json?: string | null;
  node_types_json?: string | null;
  views?: number | null;
  node_count?: number | null;
  source_url?: string | null;
};

export type RankedTemplate = TemplateCandidate & {
  score: number;
  matchedSystems: string[];
  matchedDomains: string[];
  matchedNodeTypes: string[];
  matchedTriggerTypes: string[];
  matchedPatternTypes: string[];
  keywordMatches: string[];
  reasons: string[];
};

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function includesAny(text: string, words: string[]): boolean {
  return words.some((word) => text.includes(word));
}

export function extractIntentProfile(intent: string): IntentProfile {
  const normalizedIntent = intent.trim().toLowerCase().replace(/\s+/g, " ");
  const systems: string[] = [];
  const domains: string[] = [];
  const nodeTypes: string[] = [];
  const triggerTypes: string[] = [];
  const patternTypes: string[] = [];
  const keywords: string[] = [];

  const addKeyword = (...items: string[]) => keywords.push(...items);

  if (includesAny(normalizedIntent, ["amazon ads", "advertising-api.amazon", "campaign", "spend", "acos"])) {
    systems.push("Amazon Ads");
    domains.push("advertising");
    nodeTypes.push("httpRequest");
    patternTypes.push("http_api_integration");
    addKeyword("amazon", "ads", "campaign", "spend");
  }
  if (includesAny(normalizedIntent, ["google sheets", "spreadsheet", "sheet", "表格"])) {
    systems.push("Google Sheets");
    nodeTypes.push("googleSheets");
    addKeyword("google", "sheets");
  }
  if (includesAny(normalizedIntent, ["slack", "通知", "alert", "message"])) {
    systems.push("Slack");
    domains.push("notifications");
    nodeTypes.push("slack");
    addKeyword("slack");
  }
  if (includesAny(normalizedIntent, ["shopify", "order", "orders", "订单"])) {
    systems.push("Shopify");
    domains.push("orders");
    nodeTypes.push("shopify", "httpRequest");
    patternTypes.push("webhook_processing");
    addKeyword("shopify", "orders");
  }
  if (includesAny(normalizedIntent, ["inventory", "stock", "sku", "库存"])) {
    domains.push("inventory");
    addKeyword("inventory", "stock");
  }
  if (includesAny(normalizedIntent, ["daily", "每天", "schedule", "cron", "定时"])) {
    triggerTypes.push("schedule");
    nodeTypes.unshift("scheduleTrigger");
    patternTypes.push("scheduled_task");
  }
  if (includesAny(normalizedIntent, ["webhook", "回调"])) {
    triggerTypes.push("webhook");
    nodeTypes.unshift("webhook");
    patternTypes.push("webhook_processing");
  }
  if (includesAny(normalizedIntent, ["batch", "pagination", "page", "分页", "批量"])) {
    nodeTypes.push("splitInBatches");
    patternTypes.push("batch_processing");
  }
  if (includesAny(normalizedIntent, ["ai agent", "chatbot", "assistant", "聊天机器人", "智能体"])) {
    nodeTypes.push("aiAgent");
    patternTypes.push("ai_agent");
  }

  return {
    normalizedIntent,
    systems: unique(systems),
    domains: unique(domains),
    nodeTypes: unique(nodeTypes),
    triggerTypes: unique(triggerTypes),
    patternTypes: unique(patternTypes),
    keywords: unique(keywords),
  };
}

export function buildTemplateSearchQuery(profile: IntentProfile): string {
  return unique([
    ...profile.systems,
    ...profile.domains,
    ...profile.patternTypes,
    ...profile.nodeTypes,
    ...profile.keywords.slice(0, 8),
  ]).join(" ");
}

function parseJsonArray(value?: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function candidateText(candidate: TemplateCandidate): string {
  return [
    candidate.name,
    candidate.description ?? "",
    ...parseJsonArray(candidate.categories_json),
    ...parseJsonArray(candidate.node_types_json),
  ]
    .join(" ")
    .toLowerCase();
}

function systemMatches(system: string, text: string, nodeTypes: string[]): boolean {
  const normalizedSystem = system.toLowerCase();
  if (text.includes(normalizedSystem)) return true;

  const loweredNodeTypes = nodeTypes.map((nodeType) => nodeType.toLowerCase());
  if (system === "Google Sheets") {
    return loweredNodeTypes.some((nodeType) => nodeType.includes("googlesheets"));
  }
  if (system === "Slack") return loweredNodeTypes.some((nodeType) => nodeType.includes("slack"));
  if (system === "Shopify") {
    return loweredNodeTypes.some((nodeType) => nodeType.includes("shopify"));
  }
  return false;
}

function ratio(matches: string[], required: string[]): number {
  if (required.length === 0) return 1;
  return matches.length / required.length;
}

function popularityScore(views?: number | null): number {
  if (!views || views <= 0) return 0;
  return Math.min(1, Math.log10(views + 1) / 4);
}

function inferCandidatePatterns(text: string, nodeTypes: string[]): string[] {
  const loweredNodeTypes = nodeTypes.map((nodeType) => nodeType.toLowerCase());
  const patterns: string[] = [];
  if (
    loweredNodeTypes.some(
      (nodeType) =>
        nodeType.includes("webhook") ||
        (nodeType.includes("trigger") &&
          !nodeType.includes("schedule") &&
          !nodeType.includes("manual")),
    ) ||
    text.includes("webhook")
  ) {
    patterns.push("webhook_processing");
  }
  if (
    loweredNodeTypes.some((nodeType) => nodeType.includes("schedule") || nodeType.includes("cron")) ||
    text.includes("daily") ||
    text.includes("scheduled")
  ) {
    patterns.push("scheduled_task");
  }
  if (loweredNodeTypes.some((nodeType) => nodeType.includes("httprequest"))) {
    patterns.push("http_api_integration");
  }
  if (loweredNodeTypes.some((nodeType) => /(postgres|mysql|mongodb|database)/.test(nodeType))) {
    patterns.push("database_operation");
  }
  if (loweredNodeTypes.some((nodeType) => nodeType.includes("langchain") || nodeType.includes("openai") || nodeType.includes("aiagent"))) {
    patterns.push("ai_agent");
  }
  if (loweredNodeTypes.some((nodeType) => nodeType.includes("splitinbatches")) || text.includes("pagination")) {
    patterns.push("batch_processing");
  }
  return unique(patterns);
}

export function rankWorkflowTemplateCandidates(
  profile: IntentProfile,
  candidates: TemplateCandidate[],
  limit = 3,
): RankedTemplate[] {
  return candidates
    .map((candidate) => {
      const text = candidateText(candidate);
      const nodeTypes = parseJsonArray(candidate.node_types_json);
      const candidatePatterns = inferCandidatePatterns(text, nodeTypes);
      const matchedSystems = profile.systems.filter((system) =>
        systemMatches(system, text, nodeTypes),
      );
      const matchedDomains = profile.domains.filter((domain) => text.includes(domain.toLowerCase()));
      const matchedNodeTypes = profile.nodeTypes.filter((nodeType) =>
        nodeTypes.some((candidateNodeType) => candidateNodeType.toLowerCase().includes(nodeType.toLowerCase())),
      );
      const matchedTriggerTypes = profile.triggerTypes.filter((triggerType) =>
        nodeTypes.some((candidateNodeType) => candidateNodeType.toLowerCase().includes(triggerType.toLowerCase())),
      );
      const matchedPatternTypes = profile.patternTypes.filter((patternType) =>
        candidatePatterns.includes(patternType),
      );
      const keywordMatches = profile.keywords.filter((keyword) => text.includes(keyword));

      const systemsScore = ratio(matchedSystems, profile.systems);
      const nodeTypesScore = ratio(matchedNodeTypes, profile.nodeTypes);
      const domainsScore = ratio(matchedDomains, profile.domains);
      const triggerScore = ratio(matchedTriggerTypes, profile.triggerTypes);
      const patternScore = ratio(matchedPatternTypes, profile.patternTypes);
      const keywordScore = ratio(keywordMatches, profile.keywords);
      const score =
        0.25 * keywordScore +
        0.25 * systemsScore +
        0.2 * nodeTypesScore +
        0.1 * domainsScore +
        0.1 * patternScore +
        0.05 * triggerScore +
        0.05 * popularityScore(candidate.views);

      const reasons: string[] = [];
      if (matchedSystems.length > 0) reasons.push(`Matches systems: ${matchedSystems.join(", ")}`);
      if (matchedNodeTypes.length > 0) {
        reasons.push(`Matches required node types: ${matchedNodeTypes.join(", ")}`);
      }
      if (matchedDomains.length > 0) reasons.push(`Matches domains: ${matchedDomains.join(", ")}`);
      if (matchedTriggerTypes.length > 0) {
        reasons.push(`Matches trigger: ${matchedTriggerTypes.join(", ")}`);
      }
      if (matchedPatternTypes.length > 0) {
        reasons.push(`Matches workflow pattern: ${matchedPatternTypes.join(", ")}`);
      }

      return {
        ...candidate,
        score: Number(score.toFixed(4)),
        matchedSystems,
        matchedDomains,
        matchedNodeTypes,
        matchedTriggerTypes,
        matchedPatternTypes,
        keywordMatches,
        reasons,
      };
    })
    .sort((a, b) => b.score - a.score || (b.views ?? 0) - (a.views ?? 0))
    .slice(0, limit);
}
