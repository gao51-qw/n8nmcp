import { getRequestId } from "@/lib/logger.server";
import { requireSupportUser } from "@/lib/support/auth.server";
import { addSupportReply } from "@/lib/support/tickets.server";
import { ReplySchema, TicketIdSchema } from "@/lib/support/validation";
import { readJson, supportJson, supportRouteError } from "../../_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireSupportUser(request);
    const { ticketId } = await context.params;
    const reply = await addSupportReply(
      user.userId,
      TicketIdSchema.parse(ticketId),
      ReplySchema.parse(await readJson(request)),
    );
    return supportJson({ reply }, requestId, 201);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
