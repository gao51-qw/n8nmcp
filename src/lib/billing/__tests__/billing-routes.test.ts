import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "8b0f7a0e-3f1c-4a59-9d64-2f0f3c6c1a11";
const BINDING_SECRET = "binding-secret-0123456789abcdefghijklmnopqrstuvwxyz";

const mocks = vi.hoisted(() => ({
  user: { userId: "", email: "ada@example.com" as string | null } as {
    userId: string;
    email: string | null;
  } | null,
  row: null as Record<string, unknown> | null,
  rowError: null as { message: string } | null,
  selects: [] as string[],
  portalCreate: vi.fn(),
}));

vi.mock("@/lib/support/auth.server", () => ({
  requireSupportUser: vi.fn(async () => {
    if (!mocks.user) {
      throw Response.json(
        { error: { code: "authentication_required", message: "Authentication required" } },
        { status: 401 },
      );
    }
    return mocks.user;
  }),
}));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    from: vi.fn(() => {
      const builder = {
        select: vi.fn((columns: string) => {
          mocks.selects.push(columns);
          return builder;
        }),
        eq: vi.fn(() => builder),
        maybeSingle: vi.fn(async () => ({ data: mocks.row, error: mocks.rowError })),
      };
      return builder;
    }),
  },
}));

vi.mock("@/lib/paddle.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/paddle.server")>();
  return {
    ...actual,
    getPaddle: () => ({ customerPortalSessions: { create: mocks.portalCreate } }),
  };
});

import { GET as getConfig } from "@/app/api/billing/config/route";
import { POST as postPortal } from "@/app/api/billing/portal/route";
import { billingConfigSchema } from "@/lib/billing/billing-types";
import { verifyCheckoutBinding } from "@/lib/billing/checkout-binding.server";

function configureSandboxPaddle() {
  vi.stubEnv("PADDLE_ENV", "sandbox");
  vi.stubEnv("PADDLE_API_KEY", "pdl_sdbx_apikey_secret_value");
  vi.stubEnv("PADDLE_CLIENT_TOKEN", "test_abc123");
  vi.stubEnv("PADDLE_PRICE_PRO", "pri_01pro");
  vi.stubEnv("PADDLE_WEBHOOK_SECRET", "pdl_ntfset_webhook_secret_value");
  vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", BINDING_SECRET);
}

function request(path: string, method = "GET") {
  return new Request(`https://dashboard.example.test${path}`, {
    method,
    headers: { authorization: "Bearer token" },
  });
}

beforeEach(() => {
  mocks.user = { userId: USER_ID, email: "ada@example.com" };
  mocks.row = null;
  mocks.rowError = null;
  mocks.selects = [];
  mocks.portalCreate.mockReset();
  for (const name of [
    "PADDLE_API_KEY",
    "PADDLE_CLIENT_TOKEN",
    "PADDLE_PRICE_PRO",
    "PADDLE_ENV",
    "PADDLE_WEBHOOK_SECRET",
    "BILLING_CUSTOM_DATA_SECRET",
  ]) {
    vi.stubEnv(name, "");
  }
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/billing/config", () => {
  it("requires a signed-in user", async () => {
    mocks.user = null;
    const response = await getConfig(request("/api/billing/config"));

    expect(response.status).toBe(401);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.json();
    expect(body.error.code).toBe("authentication_required");
    expect(typeof body.error.message).toBe("string");
  });

  it("returns the public checkout config and maps checkout to the user", async () => {
    configureSandboxPaddle();
    const response = await getConfig(request("/api/billing/config"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = billingConfigSchema.parse(await response.json());
    expect(body).toMatchObject({
      enabled: true,
      environment: "sandbox",
      clientToken: "test_abc123",
      prices: { pro: "pri_01pro" },
      checkout: { email: "ada@example.com", customData: { user_id: USER_ID } },
      subscription: { tier: "free", plan: "free", status: null, canManage: false },
    });
    // The customData binding is server-signed for this user and verifies.
    const customData = body.checkout!.customData;
    expect(Math.abs(customData.ts * 1000 - Date.now())).toBeLessThan(60_000);
    expect(customData.nonce).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(verifyCheckoutBinding(customData, Date.now())).toMatchObject({
      ok: true,
      userId: USER_ID,
      nonce: customData.nonce,
    });
    // Every config response carries a fresh single-use nonce.
    const again = billingConfigSchema.parse(
      await (await getConfig(request("/api/billing/config"))).json(),
    );
    expect(again.checkout!.customData.nonce).not.toBe(customData.nonce);
    // No server secret reaches the browser.
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("pdl_sdbx_apikey_secret_value");
    expect(serialized).not.toContain(BINDING_SECRET);
    expect(serialized).not.toContain("pdl_ntfset_webhook_secret_value");
  });

  it("disables checkout without a usable customData binding secret", async () => {
    for (const secret of ["", "too-short", "pdl_ntfset_webhook_secret_value_reused_000"]) {
      configureSandboxPaddle();
      vi.stubEnv("BILLING_CUSTOM_DATA_SECRET", secret);
      if (secret.startsWith("pdl_ntfset")) vi.stubEnv("PADDLE_WEBHOOK_SECRET", secret);

      const response = await getConfig(request("/api/billing/config"));
      expect(response.status).toBe(200);
      const body = billingConfigSchema.parse(await response.json());
      expect(body.enabled).toBe(false);
      expect(body.clientToken).toBeNull();
      expect(body.prices.pro).toBeNull();
      expect(body.checkout).toBeNull();
      if (secret) expect(JSON.stringify(body)).not.toContain(secret);
    }
  });

  it("reports billing as disabled when Paddle is not configured", async () => {
    const response = await getConfig(request("/api/billing/config"));

    expect(response.status).toBe(200);
    const body = billingConfigSchema.parse(await response.json());
    expect(body.enabled).toBe(false);
    expect(body.clientToken).toBeNull();
    expect(body.prices.pro).toBeNull();
    expect(body.checkout).toBeNull();
  });

  it("fails closed on a partial or mismatched Paddle config", async () => {
    configureSandboxPaddle();
    vi.stubEnv("PADDLE_PRICE_PRO", "");
    let body = billingConfigSchema.parse(await (await getConfig(request("/x"))).json());
    expect(body.enabled).toBe(false);

    configureSandboxPaddle();
    vi.stubEnv("PADDLE_CLIENT_TOKEN", "live_abc123"); // live token, sandbox env
    body = billingConfigSchema.parse(await (await getConfig(request("/x"))).json());
    expect(body.enabled).toBe(false);
    expect(body.clientToken).toBeNull();

    configureSandboxPaddle();
    vi.stubEnv("PADDLE_CLIENT_TOKEN", "test_abc<script>");
    body = billingConfigSchema.parse(await (await getConfig(request("/x"))).json());
    expect(body.enabled).toBe(false);
  });

  it("reports the granted tier, collapsing an inactive paid plan to free", async () => {
    configureSandboxPaddle();
    mocks.row = {
      tier: "pro",
      status: "past_due",
      current_period_end: "2026-12-01T00:00:00.000Z",
      billing_provider: "paddle",
      billing_customer_id: "ctm_01",
    };
    let body = billingConfigSchema.parse(await (await getConfig(request("/x"))).json());
    expect(body.subscription).toEqual({
      tier: "free",
      plan: "pro",
      status: "past_due",
      currentPeriodEnd: "2026-12-01T00:00:00.000Z",
      canManage: true,
    });

    mocks.row = { ...mocks.row, status: "active" };
    body = billingConfigSchema.parse(await (await getConfig(request("/x"))).json());
    expect(body.subscription.tier).toBe("pro");
  });

  it("returns a structured 500 when the subscription lookup fails", async () => {
    mocks.rowError = { message: "boom" };
    const response = await getConfig(request("/api/billing/config"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error.code).toBe("billing_unavailable");
    expect(JSON.stringify(body)).not.toContain("boom");
  });
});

describe("POST /api/billing/portal", () => {
  it("requires a signed-in user", async () => {
    mocks.user = null;
    const response = await postPortal(request("/api/billing/portal", "POST"));
    expect(response.status).toBe(401);
    expect(mocks.portalCreate).not.toHaveBeenCalled();
  });

  it("is unavailable when Paddle is not configured", async () => {
    const response = await postPortal(request("/api/billing/portal", "POST"));
    expect(response.status).toBe(503);
    expect((await response.json()).error.code).toBe("billing_unavailable");
  });

  it("404s without a Paddle customer", async () => {
    configureSandboxPaddle();
    mocks.row = { billing_provider: "paddle", billing_customer_id: null };
    const response = await postPortal(request("/api/billing/portal", "POST"));
    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("no_subscription");
  });

  it("returns the Paddle portal overview URL for the user's own customer", async () => {
    configureSandboxPaddle();
    mocks.row = {
      billing_provider: "paddle",
      billing_customer_id: "ctm_01",
      billing_subscription_id: "sub_01",
    };
    mocks.portalCreate.mockResolvedValue({
      urls: { general: { overview: "https://sandbox-customer-portal.paddle.com/cpl_01?token=t" } },
    });

    const response = await postPortal(request("/api/billing/portal", "POST"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({
      url: "https://sandbox-customer-portal.paddle.com/cpl_01?token=t",
    });
    expect(mocks.portalCreate).toHaveBeenCalledWith("ctm_01", ["sub_01"]);
  });

  it("refuses a portal URL that is not an https paddle.com URL", async () => {
    configureSandboxPaddle();
    mocks.row = { billing_provider: "paddle", billing_customer_id: "ctm_01" };
    mocks.portalCreate.mockResolvedValue({
      urls: { general: { overview: "https://paddle.com.evil.example/x" } },
    });

    const response = await postPortal(request("/api/billing/portal", "POST"));
    expect(response.status).toBe(502);
    expect((await response.json()).error.code).toBe("portal_unavailable");
  });

  it("maps a Paddle API failure to a 502 without leaking details", async () => {
    configureSandboxPaddle();
    mocks.row = { billing_provider: "paddle", billing_customer_id: "ctm_01" };
    mocks.portalCreate.mockRejectedValue(new Error("paddle secret detail"));

    const response = await postPortal(request("/api/billing/portal", "POST"));
    expect(response.status).toBe(502);
    expect(JSON.stringify(await response.json())).not.toContain("secret detail");
  });
});
