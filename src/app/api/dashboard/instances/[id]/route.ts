// One n8n instance of the signed-in user.
//   PATCH { mcp_token: string | null } → set (after checking) or clear the MCP token
//   PATCH { is_default: true }          → make it the instance MCP tools work with
//         (one field per request; to move MCP away, choose another instance)
//   DELETE → remove the instance and its stored secrets
import { requireSupportUser } from "@/lib/support/auth.server";
import {
  apiJson,
  HttpError,
  parseUuidParam,
  readJsonObject,
  withApiErrors,
} from "@/lib/http/api-response.server";
import {
  deleteInstance,
  InstanceError,
  setDefaultInstance,
  setNativeMcpToken,
} from "@/lib/n8n-instances.server";

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
      const hasToken = body !== null && "mcp_token" in body;
      const hasDefault = body !== null && "is_default" in body;
      if (!body || (!hasToken && !hasDefault)) {
        throw new HttpError(400, "invalid_request", "mcp_token or is_default is required");
      }
      if (hasToken && hasDefault) {
        throw new HttpError(
          400,
          "invalid_request",
          "Send either mcp_token or is_default, not both",
        );
      }
      if (hasDefault) {
        if (body.is_default !== true) {
          throw new HttpError(
            400,
            "invalid_request",
            "is_default can only be set to true; choose another instance to move MCP away from this one",
          );
        }
        const instance = await setDefaultInstance(user.userId, id);
        return apiJson({ instance }, { requestId });
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
