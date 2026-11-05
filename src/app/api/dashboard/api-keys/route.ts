// Platform API keys of the signed-in user.
//   GET  → keys without secrets
//   POST { name } → creates a key; the full key is in this response only
import { requireSupportUser } from "@/lib/support/auth.server";
import { ApiKeyError, createApiKey, listApiKeys } from "@/lib/platform-api-keys.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex,nofollow" };

async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ApiKeyError) {
      return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    }
    return Response.json({ error: "Request failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireSupportUser(request);
    return Response.json({ keys: await listApiKeys(user.userId) }, { headers: NO_STORE });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireSupportUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    const created = await createApiKey(user.userId, body?.name);
    return Response.json(created, { status: 201, headers: NO_STORE });
  });
}
