import { requireSupportUser } from "@/lib/support/auth.server";
import { createSupportTicket, listSupportTickets } from "@/lib/support/tickets.server";
import { CreateTicketSchema, TicketListQuerySchema } from "@/lib/support/validation";
import { getRequestId } from "@/lib/logger.server";
import { readJson, supportJson, supportRouteError } from "./_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireSupportUser(request);
    const url = new URL(request.url);
    const filters = TicketListQuerySchema.parse({
      status: url.searchParams.get("status") || undefined,
      search: url.searchParams.get("search") || undefined,
    });
    const tickets = await listSupportTickets(user.userId, filters);
    return supportJson({ tickets }, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}

export async function POST(request: Request) {
  const requestId = getRequestId(request);
  try {
    const user = await requireSupportUser(request);
    const input = CreateTicketSchema.parse(await readJson(request));
    const ticket = await createSupportTicket(user, input, requestId);
    return supportJson({ ticket }, requestId, 201);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
