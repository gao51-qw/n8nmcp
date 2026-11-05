// n8n instances of the signed-in user.
//   GET  → instances without secrets
//   POST { name, base_url, api_key, mcp_token? } → checked against n8n, stored encrypted
import { requireSupportUser } from "@/lib/support/auth.server";
import {
  createInstance,
  handleInstanceRequest,
  InstanceError,
  listInstances,
} from "@/lib/n8n-instances.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex,nofollow" };

export async function GET(request: Request) {
  return handleInstanceRequest(async () => {
    const user = await requireSupportUser(request);
    return Response.json({ instances: await listInstances(user.userId) }, { headers: NO_STORE });
  });
}

export async function POST(request: Request) {
  return handleInstanceRequest(async () => {
    const user = await requireSupportUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new InstanceError("Invalid JSON body", 400);
    const instance = await createInstance(user.userId, body);
    return Response.json({ instance }, { status: 201, headers: NO_STORE });
  });
}
