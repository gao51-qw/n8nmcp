// Platform API keys of the signed-in user.
//   GET  → keys without secrets
//   POST { name } → creates a key; the full key is in this response only
import { requireSupportUser } from "@/lib/support/auth.server";
import { apiJson, readJsonObject, withApiErrors } from "@/lib/http/api-response.server";
import { ApiKeyError, createApiKey, listApiKeys } from "@/lib/platform-api-keys.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPTIONS = { expose: [ApiKeyError] };

export async function GET(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      return apiJson({ keys: await listApiKeys(user.userId) }, { requestId });
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
      const created = await createApiKey(user.userId, body?.name);
      return apiJson(created, { status: 201, requestId });
    },
    OPTIONS,
  );
}
