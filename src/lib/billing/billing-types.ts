// Billing API contracts shared by the route handlers and the dashboard
// billing page. Safe to import on the client: no secrets live here.
import { z } from "zod";

export const billingErrorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

export type BillingErrorBody = z.infer<typeof billingErrorSchema>;

export const billingSubscriptionSchema = z.object({
  /** The tier the account is granted right now (paid tiers need an active status). */
  tier: z.enum(["free", "pro", "enterprise"]),
  /** The tier on the stored subscription row, even when it is not active. */
  plan: z.enum(["free", "pro", "enterprise"]),
  status: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  /** A Paddle customer exists, so the customer portal can be opened. */
  canManage: z.boolean(),
});

export type BillingSubscription = z.infer<typeof billingSubscriptionSchema>;

export const billingConfigSchema = z.object({
  enabled: z.boolean(),
  environment: z.enum(["sandbox", "production"]),
  /** Paddle.js client-side token: public by Paddle's design. */
  clientToken: z.string().nullable(),
  prices: z.object({ pro: z.string().nullable() }),
  checkout: z
    .object({
      email: z.string().nullable(),
      /**
       * Server-signed checkout binding, passed to Paddle.js as-is. The webhook
       * binds a new subscription to `user_id` only when `sig` verifies
       * (HMAC-SHA256 over "v1:<user_id>:<ts>") and `ts` is recent.
       */
      customData: z.object({
        user_id: z.string().uuid(),
        ts: z.number().int().positive(),
        sig: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
      }),
    })
    .nullable(),
  subscription: billingSubscriptionSchema,
});

export type BillingConfigResponse = z.infer<typeof billingConfigSchema>;

export const billingPortalSchema = z.object({ url: z.string().url() });

export type BillingPortalResponse = z.infer<typeof billingPortalSchema>;
