// @vitest-environment jsdom

import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

async function renderPricing(env: Record<string, string>) {
  vi.resetModules();
  for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
  const { default: PricingPage } = await import("../page");
  const html = renderToStaticMarkup(<PricingPage />);
  const doc = new DOMParser().parseFromString(html, "text/html");
  return doc;
}

const production = {
  NEXT_PUBLIC_MCP_SITE_URL: "https://mcp.example.test",
  NEXT_PUBLIC_DOCS_URL: "https://docs.example.test",
  NEXT_PUBLIC_BLOG_URL: "https://blog.example.test",
  NEXT_PUBLIC_DASHBOARD_URL: "https://dashboard.example.test",
};

describe("pricing page", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("renders Free, Pro and Enterprise from the tier definitions", async () => {
    const doc = await renderPricing(production);
    const { TIER_LABELS, TIER_PRICES, formatDailyCalls } = await import("@/lib/tiers");

    const plans = Array.from(doc.querySelectorAll("[data-plan]"));
    expect(plans.map((p) => p.getAttribute("data-plan"))).toEqual(["free", "pro", "enterprise"]);

    for (const plan of plans) {
      const tier = plan.getAttribute("data-plan") as "free" | "pro" | "enterprise";
      expect(plan.querySelector("h2")?.textContent).toBe(TIER_LABELS[tier]);
      expect(plan.textContent).toContain(TIER_PRICES[tier]);
      expect(plan.textContent).toContain(formatDailyCalls(tier));
    }
    expect(plans[0].textContent).toContain("100 MCP calls / day");
    expect(plans[1].textContent).toContain("$19");
    expect(plans[1].textContent).toContain("100,000 MCP calls / day");
    expect(plans[2].textContent).toContain("Contact");
    expect(plans[2].textContent).toContain("Unlimited MCP calls");
  });

  it("links each plan to signup, dashboard billing and sales contact", async () => {
    const doc = await renderPricing(production);
    const cta = (tier: string) =>
      doc.querySelector(`[data-plan="${tier}"] a`)?.getAttribute("href") ?? "";

    expect(cta("free")).toBe("https://dashboard.example.test/signup");
    expect(cta("pro")).toBe("https://dashboard.example.test/billing");
    expect(cta("enterprise")).toMatch(/^mailto:[^?]+@[^?]+\?subject=/);
  });

  it("uses same-origin paths in single-origin development", async () => {
    const doc = await renderPricing({
      NEXT_PUBLIC_MCP_SITE_URL: "http://localhost:3000",
      NEXT_PUBLIC_DOCS_URL: "http://localhost:3000",
      NEXT_PUBLIC_BLOG_URL: "http://localhost:3000",
      NEXT_PUBLIC_DASHBOARD_URL: "http://localhost:3000",
    });
    const cta = (tier: string) =>
      doc.querySelector(`[data-plan="${tier}"] a`)?.getAttribute("href") ?? "";

    expect(cta("free")).toBe("/signup");
    expect(cta("pro")).toBe("/dashboard/billing");
  });
});
