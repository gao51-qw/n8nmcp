import { getRequestId } from "@/lib/logger.server";
import {
  getAdminTicket,
  transferSupportTicket,
  updateSupportTicketPriority,
  updateSupportTicketStatus,
} from "@/lib/support/admin.server";
import { requireSupportAdmin } from "@/lib/support/auth.server";
import { TicketIdSchema } from "@/lib/support/validation";
import { readJson, supportJson, supportRouteError } from "../../../tickets/_route";
import { AdminTicketMutationSchema } from "../../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    await requireSupportAdmin(request);
    const { ticketId } = await context.params;
    const result = await getAdminTicket(TicketIdSchema.parse(ticketId));
    return supportJson(result, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireSupportAdmin(request);
    const { ticketId: rawTicketId } = await context.params;
    const ticketId = TicketIdSchema.parse(rawTicketId);
    const input = AdminTicketMutationSchema.parse(await readJson(request));
    const ticket =
      input.action === "transfer"
        ? await transferSupportTicket(ticketId, admin.userId, input.assignedTo)
        : input.action === "status"
          ? await updateSupportTicketStatus(ticketId, admin.userId, input.status)
          : await updateSupportTicketPriority(ticketId, admin.userId, input.priority);
    return supportJson({ ticket }, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
