import { getRequestId } from "@/lib/logger.server";
import { requireSupportUser } from "@/lib/support/auth.server";
import { getSupportTicket } from "@/lib/support/tickets.server";
import { TicketIdSchema } from "@/lib/support/validation";
import { supportJson, supportRouteError } from "../_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireSupportUser(request);
    const { ticketId } = await context.params;
    const result = await getSupportTicket(user.userId, TicketIdSchema.parse(ticketId));
    return supportJson(result, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
