// POST /api/internal/billing/audit-bindings?limit=50&cursor=<user_id>
//
// Read-only audit of stored Paddle bindings: compares each Paddle customer's
// email with the bound account's email. Authenticated with
// `Authorization: Bearer $BILLING_CRON_SECRET`, like sync-subscriptions.
// `limit` is 1..200 (default 50); pass the response's `nextCursor` as
// `cursor` to continue. Writes nothing.
import { z } from "zod";
import {
  auditPaddleBindings,
  BINDING_AUDIT_DEFAULT_LIMIT,
  BINDING_AUDIT_MAX_LIMIT,
} from "@/lib/billing/binding-audit.server";
import { isBillingCronAuthorized } from "@/lib/billing/cron-auth.server";
import { errorFields } from "@/lib/error-fields.server";
import { getRequestId, log } from "@/lib/logger.server";
import { isPaddleConfigured } from "@/lib/paddle.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const querySchema = z.object({
  limit: z
    .string()
    .regex(/^[0-9]{1,3}$/)
    .transform(Number)
    .pipe(z.number().int().min(1).max(BINDING_AUDIT_MAX_LIMIT))
    .optional(),
  cursor: z.string().regex(UUID).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const requestId = getRequestId(request);
  const headers = { "x-request-id": requestId, "cache-control": "no-store" };
  if (!isBillingCronAuthorized(request)) {
    return Response.json({ error: "Unauthorized", requestId }, { status: 401, headers });
  }

  const params = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({
    limit: params.get("limit") ?? undefined,
    cursor: params.get("cursor") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json(
      {
        error: `Invalid query: limit must be an integer from 1 to ${BINDING_AUDIT_MAX_LIMIT}, cursor a user id`,
        requestId,
      },
      { status: 400, headers },
    );
  }

  if (!isPaddleConfigured()) {
    return Response.json({ error: "Billing not configured", requestId }, { status: 503, headers });
  }

  try {
    const report = await auditPaddleBindings({
      limit: parsed.data.limit ?? BINDING_AUDIT_DEFAULT_LIMIT,
      cursor: parsed.data.cursor?.toLowerCase() ?? null,
    });
    return Response.json(report, { headers });
  } catch (error) {
    log.error("billing.binding_audit.failed", { requestId, ...errorFields(error) });
    return Response.json(
      { error: "Billing binding audit failed", requestId },
      { status: 500, headers },
    );
  }
}
