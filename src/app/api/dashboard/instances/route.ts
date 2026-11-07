// n8n instances of the signed-in user.
//   GET  → instances without secrets, each with is_default (the instance MCP uses)
//   POST { name, base_url, api_key, mcp_token? } → checked against n8n, stored encrypted
import { requireSupportUser } from "@/lib/support/auth.server";
import { apiJson, HttpError, readJsonObject, withApiErrors } from "@/lib/http/api-response.server";
import { createInstance, InstanceError, listInstances } from "@/lib/n8n-instances.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPTIONS = { expose: [InstanceError] };

export async function GET(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      return apiJson({ instances: await listInstances(user.userId) }, { requestId });
    },
    OPTIONS,
  );
}

export async function POST(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      const body = await readJsonObject(request);
      if (!body) throw new HttpError(400, "invalid_json", "Invalid JSON body");
      const instance = await createInstance(user.userId, body);
      return apiJson({ instance }, { status: 201, requestId });
    },
    OPTIONS,
  );
}
