import { getRequestId } from "@/lib/logger.server";
import { getSupportAvailability } from "@/lib/support/availability.server";
import { requireSupportUser } from "@/lib/support/auth.server";
import { supportJson, supportRouteError } from "../tickets/_route";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const requestId = getRequestId(request);
  try {
    await requireSupportUser(request);
    return supportJson(await getSupportAvailability(), requestId);
  } catch (error) {
    return supportRouteError(error, requestId);
  }
}
