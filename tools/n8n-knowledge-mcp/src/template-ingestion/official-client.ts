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
const MAX_TEMPLATE_IDS = 5_000;

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
  price: z.number().optional(),
  purchaseUrl: z.string().nullable().optional(),
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
  const config = {
    ...defaults,
    ...options,
    detailConcurrency: Math.ceil(
      boundedPositive(
        "detailConcurrency",
        options.detailConcurrency ?? defaults.detailConcurrency,
        defaults.detailConcurrency,
      ),
    ),
    requestTimeoutMs: boundedPositive(
      "requestTimeoutMs",
      options.requestTimeoutMs ?? defaults.requestTimeoutMs,
      defaults.requestTimeoutMs,
    ),
    maxAttempts: Math.ceil(
      boundedPositive(
        "maxAttempts",
        options.maxAttempts ?? defaults.maxAttempts,
        defaults.maxAttempts,
      ),
    ),
  };
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
  const cappedLimit = Math.min(MAX_TEMPLATE_IDS, Math.max(0, Math.floor(limit)));
  if (cappedLimit === 0) {
    return { totalWorkflows: 0, target: 0, summaries: [] as OfficialTemplateSummary[] };
  }

  const summaries: OfficialTemplateSummary[] = [];
  const seenIds = new Set<number>();
  let totalWorkflows: number | undefined;
  let target = cappedLimit;
  let page = 1;

  while (summaries.length < cappedLimit) {
    const url = new URL("/api/templates/search", ORIGIN);
    url.searchParams.set("rows", String(config.pageSize));
    url.searchParams.set("page", String(page));
    url.searchParams.set("sort", "views:desc");

    const result = await requestJson({ config, request, sleep }, url, searchResponseSchema);
    if (totalWorkflows === undefined) {
      totalWorkflows = result.totalWorkflows;
      target = Math.min(totalWorkflows, cappedLimit);
    }

    for (const item of result.workflows) {
      if (summaries.length >= target) break;
      if (seenIds.has(item.id)) continue;
      seenIds.add(item.id);
      summaries.push(item);
    }

    if (
      summaries.length >= target ||
      result.workflows.length === 0 ||
      page >= Math.ceil(totalWorkflows / config.pageSize)
    ) {
      break;
    }
    page += 1;
  }

  return {
    totalWorkflows: totalWorkflows ?? 0,
    target,
    summaries,
  };
}

async function fetchDetails({
  config,
  request,
  sleep,
  summaries,
}: RequestContext & { summaries: OfficialTemplateSummary[] }) {
  const limitedSummaries: OfficialTemplateSummary[] = [];
  const seenIds = new Set<number>();
  for (const summary of summaries) {
    if (seenIds.has(summary.id)) continue;
    seenIds.add(summary.id);
    limitedSummaries.push(summary);
    if (limitedSummaries.length >= MAX_TEMPLATE_IDS) break;
  }

  const details: Array<OfficialTemplateDetail | undefined> = new Array(limitedSummaries.length);
  const failedIds: number[] = [];
  let nextIndex = 0;

  const worker = async () => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      const summary = limitedSummaries[index];
      if (!summary) return;

      try {
        const url = new URL(`/workflows/templates/${summary.id}`, ORIGIN);
        details[index] = await requestJson({ config, request, sleep }, url, detailSchema);
      } catch {
        failedIds.push(summary.id);
      }
    }
  };

  const workerCount = Math.min(config.detailConcurrency, limitedSummaries.length);
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
      if (!isJsonContentType(contentType)) {
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

function boundedPositive(name: string, value: number, ceiling: number): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive finite number`);
  }
  return Math.min(value, ceiling);
}

function isJsonContentType(contentType: string): boolean {
  const mediaType = contentType.split(";", 1)[0]?.trim() ?? "";
  const token = "[!#$%&'*+.^_`|~0-9A-Za-z-]+";
  return (
    mediaType === "application/json" ||
    new RegExp(`^${token}/${token}\\+json$`, "i").test(mediaType)
  );
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
