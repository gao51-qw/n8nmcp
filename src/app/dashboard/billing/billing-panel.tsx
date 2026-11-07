"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { initializePaddle, type Paddle, type PaddleEventData } from "@paddle/paddle-js";
import { AlertCircle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  billingConfigSchema,
  billingPortalSchema,
  type BillingConfigResponse,
} from "@/lib/billing/billing-types";
import { surfaceHref } from "@/lib/site-navigation";
import { supportFetch } from "@/lib/support/http.client";
import { formatDailyCalls, TIER_LABELS, TIER_PRICE_PERIODS, TIER_PRICES } from "@/lib/tiers";

const POLL_INTERVAL_MS = 3000;
const POLL_ATTEMPTS = 10;

async function fetchBillingConfig(): Promise<BillingConfigResponse> {
  // Fail closed: an unexpected payload is treated as an error, not as config.
  return billingConfigSchema.parse(await supportFetch<unknown>("/api/billing/config"));
}

/** "past_due" → "Past due": only the first letter is capitalised, never every word. */
function sentenceCase(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function statusLabel(config: BillingConfigResponse): string {
  const { status, plan, tier } = config.subscription;
  if (!status || plan === "free") return "No paid subscription";
  if (plan !== tier) return `${TIER_LABELS[plan]} (${status.replace(/_/g, " ")}, not active)`;
  return sentenceCase(status);
}

function formatDate(value: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function BillingPanel() {
  const [config, setConfig] = useState<BillingConfigResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paddle, setPaddle] = useState<Paddle | null>(null);
  const [opening, setOpening] = useState(false);
  const [portalLoading, setPortalLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await fetchBillingConfig();
      setConfig(next);
      setError(null);
      return next;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Billing details could not be loaded.");
      return null;
    }
  }, []);

  // After checkout the webhook updates the subscription asynchronously; poll
  // briefly until the paid tier shows up.
  const pollForUpgrade = useCallback(
    (attempt = 0) => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
      pollTimer.current = setTimeout(async () => {
        const next = await load();
        if (next && next.subscription.tier !== "free") {
          setProcessing(false);
          return;
        }
        if (attempt + 1 < POLL_ATTEMPTS) pollForUpgrade(attempt + 1);
        else setProcessing(false);
      }, POLL_INTERVAL_MS);
    },
    [load],
  );

  useEffect(() => {
    void load();
    return () => {
      if (pollTimer.current) clearTimeout(pollTimer.current);
    };
  }, [load]);

  const checkoutEnabled = Boolean(config?.enabled && config.clientToken && config.prices.pro);
  const clientToken = config?.clientToken ?? null;
  const environment = config?.environment ?? "sandbox";

  useEffect(() => {
    if (!checkoutEnabled || !clientToken) return;
    let cancelled = false;
    initializePaddle({
      environment,
      token: clientToken,
      eventCallback: (event: PaddleEventData) => {
        if (event.name === "checkout.completed") {
          setProcessing(true);
          pollForUpgrade();
        }
      },
    })
      .then((instance) => {
        if (!cancelled && instance) setPaddle(instance);
      })
      .catch(() => {
        if (!cancelled) setError("The checkout could not be loaded. Try again later.");
      });
    return () => {
      cancelled = true;
    };
  }, [checkoutEnabled, clientToken, environment, pollForUpgrade]);

  async function openCheckout() {
    if (!paddle || !config?.prices.pro || !config.checkout) return;
    setOpening(true);
    try {
      // The signed customData is single use: one binding per nonce. Fetch a
      // fresh one for every checkout so a second purchase is not rejected.
      const fresh = await load();
      if (!fresh?.enabled || !fresh.prices.pro || !fresh.checkout) return;
      paddle.Checkout.open({
        items: [{ priceId: fresh.prices.pro, quantity: 1 }],
        ...(fresh.checkout.email ? { customer: { email: fresh.checkout.email } } : {}),
        // The webhook binds the subscription to this account only through the
        // server-signed customData { user_id, ts, nonce, sig }.
        customData: fresh.checkout.customData,
        settings: { displayMode: "overlay", allowLogout: false },
      });
    } finally {
      setOpening(false);
    }
  }

  async function openPortal() {
    setPortalLoading(true);
    setError(null);
    try {
      const { url } = billingPortalSchema.parse(
        await supportFetch<unknown>("/api/billing/portal", { method: "POST" }),
      );
      window.location.assign(url);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The billing portal could not be opened.");
      setPortalLoading(false);
    }
  }

  if (!config && !error) {
    return (
      <div className="flex items-center gap-3 text-sm text-muted-foreground" aria-live="polite">
        <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        Loading billing details...
      </div>
    );
  }

  const tier = config?.subscription.tier ?? "free";
  const renews = formatDate(config?.subscription.currentPeriodEnd ?? null);
  const proPeriod = TIER_PRICE_PERIODS.pro;

  return (
    <div className="space-y-6">
      {error ? (
        <div
          role="alert"
          className="flex gap-3 rounded-lg border border-destructive/50 p-4 text-sm text-destructive"
        >
          <AlertCircle className="h-5 w-5 shrink-0" aria-hidden="true" />
          <p>{error}</p>
        </div>
      ) : null}

      {config ? (
        <section
          aria-labelledby="current-plan"
          className="rounded-lg border border-border bg-card p-6"
        >
          <h2 id="current-plan" className="text-lg font-semibold">
            Current plan
          </h2>
          <dl className="mt-4 grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Plan</dt>
              <dd className="mt-1 text-xl font-semibold" data-testid="billing-tier">
                {TIER_LABELS[tier]}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="mt-1">{statusLabel(config)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Daily quota</dt>
              <dd className="mt-1">{formatDailyCalls(tier)}</dd>
            </div>
            {renews && tier !== "free" ? (
              <div>
                <dt className="text-muted-foreground">Current period ends</dt>
                <dd className="mt-1">{renews}</dd>
              </div>
            ) : null}
          </dl>

          {config.subscription.canManage ? (
            <Button
              className="mt-6"
              variant="outline"
              onClick={openPortal}
              disabled={portalLoading}
            >
              {portalLoading ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <ExternalLink aria-hidden="true" />
              )}
              Manage subscription
            </Button>
          ) : null}
        </section>
      ) : null}

      {config && tier === "free" ? (
        <section aria-labelledby="upgrade" className="rounded-lg border border-primary/60 p-6">
          <h2 id="upgrade" className="text-lg font-semibold">
            {TIER_LABELS.pro}: {TIER_PRICES.pro}
            {proPeriod ? ` ${proPeriod}` : ""}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {formatDailyCalls("pro")}, audit log export and higher rate limits.{" "}
            <a href={surfaceHref("mcp", "/pricing")} className="text-primary hover:underline">
              Compare plans
            </a>
          </p>

          {processing ? (
            <p role="status" className="mt-4 flex items-center gap-2 text-sm">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Payment received. Activating your plan...
            </p>
          ) : checkoutEnabled ? (
            <Button
              className="mt-4"
              onClick={() => void openCheckout()}
              disabled={!paddle || opening}
            >
              {!paddle || opening ? <Loader2 className="animate-spin" aria-hidden="true" /> : null}
              Upgrade to {TIER_LABELS.pro}
            </Button>
          ) : (
            <p role="status" className="mt-4 text-sm text-muted-foreground">
              Online billing is not available right now. Contact support to change your plan.
            </p>
          )}
        </section>
      ) : null}

      {config && tier !== "free" ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <CheckCircle2 className="h-4 w-4 text-primary" aria-hidden="true" />
          Your {TIER_LABELS[tier]} plan is active.{" "}
          <Link href="/dashboard" className="text-primary hover:underline">
            Back to the dashboard
          </Link>
        </p>
      ) : null}
    </div>
  );
}
