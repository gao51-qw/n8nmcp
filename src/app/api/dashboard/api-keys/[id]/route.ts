// DELETE → revoke one platform API key of the signed-in user.
import { requireSupportUser } from "@/lib/support/auth.server";
import { apiJson, parseUuidParam, withApiErrors } from "@/lib/http/api-response.server";
import { ApiKeyError, revokeApiKey } from "@/lib/platform-api-keys.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      const id = parseUuidParam((await context.params).id, "API key not found");
      await revokeApiKey(user.userId, id);
      return apiJson({ ok: true }, { requestId });
    },
    { expose: [ApiKeyError] },
  );
}
