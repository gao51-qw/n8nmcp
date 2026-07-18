import { getRequestId } from "@/lib/logger.server";
import { addSupportTicketTag, removeSupportTicketTag } from "@/lib/support/admin.server";
import { requireSupportAdmin } from "@/lib/support/auth.server";
import { TicketIdSchema } from "@/lib/support/validation";
import { readJson, supportJson, supportRouteError } from "../../../../tickets/_route";
import { AdminTagSchema } from "../../../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireSupportAdmin(request);
    const { ticketId } = await context.params;
    const input = AdminTagSchema.parse(await readJson(request));
    const tag = await addSupportTicketTag(TicketIdSchema.parse(ticketId), admin.userId, input.tag);
    return supportJson({ tag }, requestId, 201);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}

export async function DELETE(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireSupportAdmin(request);
    const { ticketId } = await context.params;
    const input = AdminTagSchema.parse(await readJson(request));
    const tag = await removeSupportTicketTag(
      TicketIdSchema.parse(ticketId),
      admin.userId,
      input.tag,
    );
    return supportJson({ tag }, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
