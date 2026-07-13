import { z } from "zod";
import type {
  OfficialTemplateClientOptions,
  OfficialTemplateDetail,
  OfficialTemplateSummary,
} from "./types.js";

const ORIGIN = "https://api.n8n.io";
const defaults = {
  pageSize: 100,
  detailConcurrency: 4,
  requestTimeoutMs: 15_000,
  maxAttempts: 3,
  maxResponseBytes: 10_485_760,
};

const userSchema = z
  .object({
    name: z.string().optional(),
    username: z.string().optional(),
    avatar: z.string().nullable().optional(),
  })
  .nullable();

const summarySchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable(),
  totalViews: z.number(),
  price: z.number(),
  purchaseUrl: z.string().nullable(),
  user: userSchema,
  createdAt: z.string().nullable(),
  nodes: z.array(z.unknown()),
});

const searchResponseSchema = z.object({
  totalWorkflows: z.number().int().nonnegative(),
  workflows: z.array(summarySchema),
});

const detailSchema = z.object({
  id: z.number(),
  name: z.string(),
  description: z.string().nullable().optional(),
  totalViews: z.number().optional(),
  user: userSchema.optional(),
  workflow: z
    .object({
      nodes: z.array(z.unknown()),
      connections: z.record(z.unknown()),
    })
    .passthrough(),
});

type Config = typeof defaults & OfficialTemplateClientOptions;
type Sleep = (ms: number) => Promise<void>;

type RequestContext = {
  config: Config;
  request: typeof globalThis.fetch;
  sleep: Sleep;
};

export function createOfficialTemplateClient(options: OfficialTemplateClientOptions = {}) {
  const config = { ...defaults, ...options };
  const request = options.fetch ?? globalThis.fetch;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));

  return {
    collectSummaries: (limit = 5_000) =>
      collectSummaries({ config, request, sleep, limit }),
    fetchDetails: (summaries: OfficialTemplateSummary[]) =>
      fetchDetails({ config, request, sleep, summaries }),
  };
}

async function collectSummaries({
  config,
  request,
  sleep,
  limit,
}: RequestContext & { limit: number }) {
  const cappedLimit = Math.max(0, Math.floor(limit));
  if (cappedLimit === 0) {
    return { totalWorkflows: 0, target: 0, summaries: [] as OfficialTemplateSummary[] };
  }

  const summaries: OfficialTemplateSummary[] = [];
  const seenIds = new Set<number>();
  let totalWorkflows = 0;
  let page = 1;

  while (summaries.length < cappedLimit) {
    const url = new URL("/api/templates/search", ORIGIN);
    url.searchParams.set("rows", String(config.pageSize));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "views:desc");

    const result = await requestJson({ config, request, sleep }, url, searchResponseSchema);
    totalWorkflows = result.totalWorkflows;
    const target = Math.min(totalWorkflows, cappedLimit);

    for (const item of result.workflows) {
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      summaries.push(item);
      if (summaries.length === target) break;
    }

    if (
      summaries.length >= target ||
      result.workflows.length === 0 ||
      page > Math.ceil(totalWorkflows / config.pageSize)
    ) {
      break;
    }
    page += 1;
  }

  return {
    totalWorkflows,
    target: Math.min(totalWorkflows, cappedLimit),
    summaries,
  };
}

async function fetchDetails({
  config,
  request,
  sleep,
  summaries,
}: RequestContext & { summaries: OfficialTemplateSummary[] }) {
  const details: Array<OfficialTemplateDetail | undefined> = new Array(summaries.length);
  const failedIds: number[] = [];
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const summary = summaries[index];
      if (!summary) return;

      try {
        const url = new URL(`/workflows/templates/${summary.id}`, ORIGIN);
        details[index] = await requestJson({ config, request, sleep }, url, detailSchema);
      } catch {
        failedIds.push(summary.id);
      }
    }
  };

  const workerCount = Math.min(Math.max(1, config.detailConcurrency), summaries.length);
  await Promise.all(Array.from({ length: workerCount }, worker));

  return {
    details: details.filter((item): item is OfficialTemplateDetail => item !== undefined),
    failedIds: failedIds.sort((a, b) => a - b),
  };
}

async function requestJson<T extends z.ZodTypeAny>(
  context: RequestContext,
  url: URL,
  schema: T,
): Promise<z.infer<T>> {
  assertOfficialUrl(url);

  for (let attempt = 1; attempt <= context.config.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), context.config.requestTimeoutMs);

    try {
      const response = await context.request(url, {
        redirect: "manual",
        signal: controller.signal,
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (location) assertOfficialUrl(new URL(location, url));
        throw new Error(`Redirect response rejected for ${url.pathname}`);
      }

      if (response.status === 429 || response.status >= 500) {
        if (attempt === context.config.maxAttempts) {
          throw new Error(`Request failed with status ${response.status} after ${attempt} attempts`);
        }
        await context.sleep(retryDelayMs(response.headers.get("retry-after"), attempt));
        continue;
      }

      if (response.status >= 400) {
        throw new Error(`Request failed with status ${response.status}`);
      }

      const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
      if (!contentType.includes("application/json")) {
        throw new Error(`Invalid content-type for ${url.pathname}: ${contentType || "missing"}`);
      }

      const contentLength = response.headers.get("content-length");
      if (contentLength !== null && Number(contentLength) > context.config.maxResponseBytes) {
        throw new Error(`Response body too large for ${url.pathname}`);
      }

      const body = await readBoundedBody(response, context.config.maxResponseBytes, url.pathname);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new Error(`Invalid JSON response for ${url.pathname}`);
      }
      return schema.parse(parsed);
    } catch (error) {
      if (controller.signal.aborted) {
        if (attempt === context.config.maxAttempts) {
          throw new Error(`Request timed out after ${attempt} attempts`, { cause: error });
        }
        await context.sleep(retryDelayMs(null, attempt));
        continue;
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw new Error("Request retry loop exited unexpectedly");
}

function assertOfficialUrl(url: URL): void {
  if (url.origin !== ORIGIN) {
    throw new Error(`Rejected redirect outside official origin: ${url.origin}`);
  }
}

function retryDelayMs(retryAfter: string | null, attempt: number): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.min(30_000, Math.max(0, seconds * 1_000));

    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.min(30_000, Math.max(0, dateDelay));
  }

  return Math.min(30_000, 500 * 2 ** (attempt - 1));
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
  pathname: string,
): Promise<string> {
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxResponseBytes) {
      await reader.cancel();
      throw new Error(`Response body too large for ${pathname}`);
    }
    chunks.push(value);
  }

  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}
