// One n8n instance of the signed-in user.
//   PATCH { mcp_token: string | null } → set (after checking) or clear the MCP token
//   DELETE → remove the instance and its stored secrets
import { requireSupportUser } from "@/lib/support/auth.server";
import {
  deleteInstance,
  handleInstanceRequest,
  InstanceError,
  setNativeMcpToken,
} from "@/lib/n8n-instances.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex,nofollow" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Context = { params: Promise<{ id: string }> };

async function instanceId(context: Context): Promise<string> {
  const { id } = await context.params;
  if (!UUID.test(id)) throw new InstanceError("Instance not found", 404);
  return id;
}

export async function PATCH(request: Request, context: Context) {
  return handleInstanceRequest(async () => {
    const user = await requireSupportUser(request);
    const id = await instanceId(context);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || !("mcp_token" in body)) throw new InstanceError("mcp_token is required", 400);
    const instance = await setNativeMcpToken(user.userId, id, body.mcp_token);
    return Response.json({ instance }, { headers: NO_STORE });
  });
}

export async function DELETE(request: Request, context: Context) {
  return handleInstanceRequest(async () => {
    const user = await requireSupportUser(request);
    await deleteInstance(user.userId, await instanceId(context));
    return Response.json({ ok: true }, { headers: NO_STORE });
  });
}
