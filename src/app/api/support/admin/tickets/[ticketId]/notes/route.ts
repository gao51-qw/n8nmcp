import { getRequestId } from "@/lib/logger.server";
import { addSupportInternalNote, updateSupportInternalNote } from "@/lib/support/admin.server";
import { requireSupportAdmin } from "@/lib/support/auth.server";
import { TicketIdSchema } from "@/lib/support/validation";
import { readJson, supportJson, supportRouteError } from "../../../../tickets/_route";
import { AdminNoteCreateSchema, AdminNoteUpdateSchema } from "../../../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ ticketId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireSupportAdmin(request);
    const { ticketId } = await context.params;
    const input = AdminNoteCreateSchema.parse(await readJson(request));
    const note = await addSupportInternalNote(
      TicketIdSchema.parse(ticketId),
      admin.userId,
      input.body,
    );
    return supportJson({ note }, requestId, 201);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireSupportAdmin(request);
    const { ticketId } = await context.params;
    const input = AdminNoteUpdateSchema.parse(await readJson(request));
    const note = await updateSupportInternalNote(
      TicketIdSchema.parse(ticketId),
      input.noteId,
      admin.userId,
      input.body,
    );
    return supportJson({ note }, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
