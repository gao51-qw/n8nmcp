// DELETE → revoke one platform API key of the signed-in user.
import { requireSupportUser } from "@/lib/support/auth.server";
import { ApiKeyError, revokeApiKey } from "@/lib/platform-api-keys.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex,nofollow" };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireSupportUser(request);
    const { id } = await context.params;
    if (!UUID.test(id)) throw new ApiKeyError("API key not found", 404);
    await revokeApiKey(user.userId, id);
    return Response.json({ ok: true }, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof ApiKeyError) {
      return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    }
    return Response.json({ error: "Request failed" }, { status: 500, headers: NO_STORE });
  }
}
