// One n8n instance of the signed-in user.
//   PATCH { mcp_token: string | null } → set (after checking) or clear the MCP token
//   DELETE → remove the instance and its stored secrets
import { requireSupportUser } from "@/lib/support/auth.server";
import {
  apiJson,
  HttpError,
  parseUuidParam,
  readJsonObject,
  withApiErrors,
} from "@/lib/http/api-response.server";
import { deleteInstance, InstanceError, setNativeMcpToken } from "@/lib/n8n-instances.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const OPTIONS = { expose: [InstanceError] };

async function instanceId(context: Context): Promise<string> {
  return parseUuidParam((await context.params).id, "Instance not found");
}

export async function PATCH(request: Request, context: Context) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      const id = await instanceId(context);
      const body = await readJsonObject(request);
      if (!body || !("mcp_token" in body)) {
        throw new HttpError(400, "invalid_request", "mcp_token is required");
      }
      const instance = await setNativeMcpToken(user.userId, id, body.mcp_token);
      return apiJson({ instance }, { requestId });
    },
    OPTIONS,
  );
}

export async function DELETE(request: Request, context: Context) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      await deleteInstance(user.userId, await instanceId(context));
      return apiJson({ ok: true }, { requestId });
    },
    OPTIONS,
  );
}
