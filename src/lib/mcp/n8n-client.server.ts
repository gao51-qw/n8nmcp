// n8n Public API client for MCP tools (server-only). Every request to the
// user-controlled instance URL goes through the SSRF guard (safeFetchPublicUrl).
import type { N8nInstance } from "./types";

export async function n8n(inst: N8nInstance, path: string, init?: RequestInit) {
  const url = `${inst.base_url}${path}`;
  const { safeFetchPublicUrl } = await import("@/lib/ssrf-guard.server");
  const { traceHeaders } = await import("@/lib/trace-context.server");
  const res = await safeFetchPublicUrl(url, {
    ...init,
    headers: {
      ...traceHeaders(),
      "X-N8N-API-KEY": inst.api_key,
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(20_000),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`n8n request failed with status ${res.status}`);
  }
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    // Successful non-JSON responses are returned as text.
  }
  return body;
}
