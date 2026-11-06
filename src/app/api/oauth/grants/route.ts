// Connected MCP apps for the signed-in user.
//   GET    → active grants
//   POST   { authorization_id, scopes } → record the scopes chosen on the consent page
//   DELETE ?client_id=… → revoke
import { requireSupportUser } from "@/lib/support/auth.server";
import { apiJson, HttpError, readJsonObject, withApiErrors } from "@/lib/http/api-response.server";
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

const OPTIONS = { expose: [GrantError] };

function bearerToken(request: Request): string {
  return (
    request.headers
      .get("authorization")
      ?.match(/^Bearer\s+(.+)$/i)?.[1]
      ?.trim() ?? ""
  );
}

export async function GET(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      return apiJson({ grants: await listGrants(user.userId) }, { requestId });
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
      const scopes = parseScopes(body.scopes);
      const details = await fetchAuthorizationDetails(body.authorization_id, bearerToken(request));
      await recordGrant(user.userId, details, scopes);
      return apiJson({ client: details.client, scopes }, { requestId });
    },
    OPTIONS,
  );
}

export async function DELETE(request: Request) {
  return withApiErrors(
    request,
    async ({ requestId }) => {
      const user = await requireSupportUser(request);
      const clientId = assertClientId(new URL(request.url).searchParams.get("client_id"));
      await revokeGrant(user.userId, clientId);
      return apiJson({ ok: true }, { requestId });
    },
    OPTIONS,
  );
}
