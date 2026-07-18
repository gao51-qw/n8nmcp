export type OfficialTemplateSummary = {
  id: number;
  name: string;
  description: string | null;
  totalViews: number;
  price?: number;
  purchaseUrl?: string | null;
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
