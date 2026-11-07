// Bearer authentication for the internal billing endpoints, which are called
// only by the VPS cron or an operator with BILLING_CRON_SECRET. Fails closed
// when the secret is unset.
import { createHash, timingSafeEqual } from "node:crypto";

export function isBillingCronAuthorized(request: Request): boolean {
  const secret = process.env.BILLING_CRON_SECRET;
  const authorization = request.headers.get("authorization");
  if (!secret || !authorization?.startsWith("Bearer ")) return false;

  const digest = (value: string) => createHash("sha256").update(value).digest();
  return timingSafeEqual(digest(authorization.slice(7)), digest(secret));
}
