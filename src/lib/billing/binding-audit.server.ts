// Read-only audit of stored Paddle subscription bindings.
//
// Bindings created before signed, single-use customData may have been forged
// (a browser could name any user_id). For each subscriptions row bound to a
// Paddle subscription this compares the Paddle customer's email with the
// bound account's email and reports every disagreement. It never writes.
//
// Emails are PII: they are compared in memory only. Logs carry the email
// domain at most, and the report carries identifiers and reasons only.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { claimedCheckoutUserId } from "@/lib/billing/checkout-binding.server";
import { log } from "@/lib/logger.server";
import { getPaddle } from "@/lib/paddle.server";

export const BINDING_AUDIT_DEFAULT_LIMIT = 50;
export const BINDING_AUDIT_MAX_LIMIT = 200;

export type BindingAuditMismatchReason =
  | "email_mismatch"
  | "auth_user_missing"
  | "auth_email_missing"
  | "paddle_email_missing"
  | "subscription_id_mismatch"
  | "customer_id_mismatch"
  | "custom_data_user_mismatch";

export type BindingAuditErrorReason =
  "paddle_subscription_lookup_failed" | "paddle_customer_lookup_failed" | "auth_user_lookup_failed";

export type BindingAuditEntry<Reason extends string = string> = {
  user_id: string;
  subscription_id: string;
  reason: Reason;
};

export type BindingAuditReport = {
  /** Rows examined in this page. */
  checked: number;
  mismatches: BindingAuditEntry<BindingAuditMismatchReason>[];
  errors: BindingAuditEntry<BindingAuditErrorReason>[];
  /** Pass as `cursor` to audit the next page; null on the last page. */
  nextCursor: string | null;
};

type BindingRow = {
  user_id: string;
  billing_subscription_id: string | null;
  billing_customer_id: string | null;
};

type RemoteSubscription = {
  id?: string | null;
  customerId?: string | null;
  customData?: unknown;
};

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

/** The part after the last "@", for logs. Never the local part. */
function emailDomain(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1) : null;
}

function errorType(cause: unknown): string {
  return cause instanceof Error ? cause.name : typeof cause;
}

export async function auditPaddleBindings(
  opts: { limit?: number; cursor?: string | null } = {},
): Promise<BindingAuditReport> {
  const limit = Math.max(
    1,
    Math.min(Math.trunc(opts.limit ?? BINDING_AUDIT_DEFAULT_LIMIT), BINDING_AUDIT_MAX_LIMIT),
  );

  let query = supabaseAdmin
    .from("subscriptions")
    .select("user_id,billing_subscription_id,billing_customer_id")
    .eq("billing_provider", "paddle")
    .not("billing_subscription_id", "is", null);
  if (opts.cursor) query = query.gt("user_id", opts.cursor);
  const { data, error } = await query.order("user_id", { ascending: true }).limit(limit);
  if (error) {
    throw new Error(`Could not load subscriptions for the binding audit: ${error.message}`);
  }

  const rows = (data ?? []) as BindingRow[];
  const report: BindingAuditReport = {
    checked: 0,
    mismatches: [],
    errors: [],
    nextCursor: rows.length === limit ? (rows[rows.length - 1]?.user_id ?? null) : null,
  };
  const paddle = getPaddle();
  const customerEmails = new Map<string, string | null>();

  const mismatch = (
    row: BindingRow & { billing_subscription_id: string },
    reason: BindingAuditMismatchReason,
    extra: Record<string, unknown> = {},
  ) => {
    report.mismatches.push({
      user_id: row.user_id,
      subscription_id: row.billing_subscription_id,
      reason,
    });
    log.warn("billing.binding_audit.mismatch", {
      user_id: row.user_id,
      subscription_id: row.billing_subscription_id,
      reason,
      ...extra,
    });
  };
  const failure = (
    row: BindingRow & { billing_subscription_id: string },
    reason: BindingAuditErrorReason,
    cause: unknown,
  ) => {
    report.errors.push({
      user_id: row.user_id,
      subscription_id: row.billing_subscription_id,
      reason,
    });
    log.warn("billing.binding_audit.lookup_failed", {
      user_id: row.user_id,
      subscription_id: row.billing_subscription_id,
      reason,
      errorType: errorType(cause),
    });
  };

  for (const candidate of rows) {
    if (!candidate.billing_subscription_id) continue;
    const row = candidate as BindingRow & { billing_subscription_id: string };
    report.checked++;

    let remote: RemoteSubscription;
    try {
      remote = (await paddle.subscriptions.get(row.billing_subscription_id)) as RemoteSubscription;
    } catch (cause) {
      failure(row, "paddle_subscription_lookup_failed", cause);
      continue;
    }
    if (remote?.id !== row.billing_subscription_id) {
      mismatch(row, "subscription_id_mismatch");
      continue;
    }

    const claimedUserId = claimedCheckoutUserId(remote.customData);
    if (claimedUserId && claimedUserId !== row.user_id.toLowerCase()) {
      mismatch(row, "custom_data_user_mismatch", { claimed_user_id: claimedUserId });
    }

    const customerId = remote.customerId ?? null;
    if (row.billing_customer_id && customerId !== row.billing_customer_id) {
      mismatch(row, "customer_id_mismatch");
    }

    let paddleEmail: string | null = null;
    if (customerId) {
      if (customerEmails.has(customerId)) {
        paddleEmail = customerEmails.get(customerId) ?? null;
      } else {
        try {
          const customer = await paddle.customers.get(customerId);
          paddleEmail = normalizedEmail(customer?.email);
          customerEmails.set(customerId, paddleEmail);
        } catch (cause) {
          failure(row, "paddle_customer_lookup_failed", cause);
          continue;
        }
      }
    }

    let authEmail: string | null;
    try {
      const { data: authData, error: authError } = await supabaseAdmin.auth.admin.getUserById(
        row.user_id,
      );
      const status = (authError as { status?: number } | null)?.status;
      if (authError && status !== 404) {
        failure(row, "auth_user_lookup_failed", authError);
        continue;
      }
      if (!authData?.user) {
        mismatch(row, "auth_user_missing");
        continue;
      }
      authEmail = normalizedEmail(authData.user.email);
    } catch (cause) {
      failure(row, "auth_user_lookup_failed", cause);
      continue;
    }

    if (!paddleEmail) {
      mismatch(row, "paddle_email_missing");
    } else if (!authEmail) {
      mismatch(row, "auth_email_missing");
    } else if (paddleEmail !== authEmail) {
      mismatch(row, "email_mismatch", {
        paddle_email_domain: emailDomain(paddleEmail),
        account_email_domain: emailDomain(authEmail),
      });
    }
  }

  log.info("billing.binding_audit.completed", {
    checked: report.checked,
    mismatches: report.mismatches.length,
    errors: report.errors.length,
    has_more: report.nextCursor !== null,
  });
  return report;
}
