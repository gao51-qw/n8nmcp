import { getRequestId } from "@/lib/logger.server";
import { requireSupportUser } from "@/lib/support/auth.server";
import { signSupportAttachments } from "@/lib/support/tickets.server";
import { SignAttachmentsSchema, TicketIdSchema } from "@/lib/support/validation";
import { readJson, supportJson, supportRouteError } from "../../_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ ticketId: string }> }) {
  const requestId = getRequestId(request);
  try {
    const user = await requireSupportUser(request);
    const { ticketId } = await context.params;
    const input = SignAttachmentsSchema.parse(await readJson(request));
    const attachments = await signSupportAttachments(
      user.userId,
      TicketIdSchema.parse(ticketId),
      input.paths,
    );
    return supportJson({ attachments }, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
