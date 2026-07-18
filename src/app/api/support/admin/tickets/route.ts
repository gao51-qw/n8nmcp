import { getRequestId } from "@/lib/logger.server";
import { listAdminTickets } from "@/lib/support/admin.server";
import { requireSupportAdmin } from "@/lib/support/auth.server";
import { supportJson, supportRouteError } from "../../tickets/_route";
import { AdminQueueSchema } from "../_schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    const admin = await requireSupportAdmin(request);
    const queue = AdminQueueSchema.parse(
      new URL(request.url).searchParams.get("queue") ?? "unassigned",
    );
    const tickets = await listAdminTickets(queue, admin.userId);
    return supportJson({ tickets }, requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
