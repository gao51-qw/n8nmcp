// Connected MCP apps for the signed-in user.
//   GET    → active grants
//   POST   { authorization_id, scopes } → record the scopes chosen on the consent page
//   DELETE ?client_id=… → revoke
import { requireSupportUser } from "@/lib/support/auth.server";
import {
  assertClientId,
  fetchAuthorizationDetails,
  GrantError,
  listGrants,
  parseScopes,
  recordGrant,
  revokeGrant,
} from "@/lib/oauth/grants.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex,nofollow" };

function bearerToken(request: Request): string {
  return (
    request.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ?? ""
  );
}

async function handle(run: () => Promise<Response>): Promise<Response> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof Response) return error;
    if (error instanceof GrantError) {
      return Response.json({ error: error.message }, { status: error.status, headers: NO_STORE });
    }
    return Response.json({ error: "Request failed" }, { status: 500, headers: NO_STORE });
  }
}

export async function GET(request: Request) {
  return handle(async () => {
    const user = await requireSupportUser(request);
    return Response.json({ grants: await listGrants(user.userId) }, { headers: NO_STORE });
  });
}

export async function POST(request: Request) {
  return handle(async () => {
    const user = await requireSupportUser(request);
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body) throw new GrantError("Invalid JSON body", 400);
    const scopes = parseScopes(body.scopes);
    const details = await fetchAuthorizationDetails(body.authorization_id, bearerToken(request));
    await recordGrant(user.userId, details, scopes);
    return Response.json({ client: details.client, scopes }, { headers: NO_STORE });
  });
}

export async function DELETE(request: Request) {
  return handle(async () => {
    const user = await requireSupportUser(request);
    const clientId = assertClientId(new URL(request.url).searchParams.get("client_id"));
    await revokeGrant(user.userId, clientId);
    return Response.json({ ok: true }, { headers: NO_STORE });
  });
}
