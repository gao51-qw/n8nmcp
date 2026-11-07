// One n8n instance of the signed-in user.
//   PATCH { mcp_token: string | null } → set (after checking) or clear the MCP token
//   PATCH { is_default: true }          → make it the instance MCP tools work with
//         (one field per request; to move MCP away, choose another instance)
//   PATCH { recheck: true }             → re-run the Public API check with the stored key
//         → { instance, check: { ok, error } }
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
  recheckInstance,
  setDefaultInstance,
  setNativeMcpToken,
} from "@/lib/n8n-instances.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ id: string }> };

const OPTIONS = { expose: [InstanceError] };

const PATCH_FIELDS = ["mcp_token", "is_default", "recheck"] as const;

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
      const fields = body ? PATCH_FIELDS.filter((field) => field in body) : [];
      if (!body || fields.length === 0) {
        throw new HttpError(400, "invalid_request", "mcp_token, is_default or recheck is required");
      }
      if (fields.length > 1) {
        throw new HttpError(
          400,
          "invalid_request",
          "Send only one of mcp_token, is_default and recheck",
        );
      }
      const [field] = fields;
      if (field === "recheck") {
        if (body.recheck !== true) {
          throw new HttpError(400, "invalid_request", "recheck can only be true");
        }
        const check = await recheckInstance(user.userId, id);
        return apiJson(
          { instance: check.instance, check: { ok: check.error === null, error: check.error } },
          { requestId },
        );
      }
      if (field === "is_default") {
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
