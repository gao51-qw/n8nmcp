import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";

const TITLE = "Quotas & billing — n8n-mcp docs";
const DESC = "Per-key request quotas, plan limits, and how usage is metered across MCP tool calls.";
const URL = "https://n8nmcp.lovable.app/docs/quotas";

export const Route = createFileRoute("/{-$locale}/docs/quotas")({
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
    ],
    links: [{ rel: "canonical", href: URL }],
    scripts: [
      {
        type: "application/ld+json",
        children: buildDocsTechArticleJsonLd({ title: TITLE, description: DESC, path: '/docs/quotas' }),
      },
      {
        type: "application/ld+json",
        children: buildBreadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Docs", path: "/docs" }, { name: 'Quotas & billing', path: '/docs/quotas' }]),
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <h1>Quotas &amp; billing</h1>
      <p className="text-muted-foreground">
        The gateway meters usage per platform API key. Each MCP tool call counts as one
        request, regardless of payload size.
      </p>

      <h2 id="plans">Plan limits</h2>
      <table>
        <thead>
          <tr><th>Plan</th><th>Requests / month</th><th>n8n instances</th><th>API keys</th></tr>
        </thead>
        <tbody>
          <tr><td>Free</td><td>1,000</td><td>1</td><td>2</td></tr>
          <tr><td>Pro</td><td>50,000</td><td>5</td><td>20</td></tr>
          <tr><td>Team</td><td>250,000</td><td>Unlimited</td><td>Unlimited</td></tr>
        </tbody>
      </table>
      <p className="text-muted-foreground">
        Self-hosted deployments have no enforced quota; the same counters are recorded
        for observability.
      </p>

      <h2 id="counting">What counts as a request</h2>
      <ul className="text-muted-foreground">
        <li>Each MCP <code>tools/call</code> = 1 request.</li>
        <li><code>tools/list</code> and <code>initialize</code> handshakes are free.</li>
        <li>Failed calls (4xx returned by the gateway) still count.</li>
        <li>Retries triggered by the client count separately.</li>
      </ul>

      <h2 id="windows">Reset window</h2>
      <p className="text-muted-foreground">
        Counters reset on the first day of each calendar month at <code>00:00 UTC</code>.
        The current usage is visible in the dashboard header and on each API key row.
      </p>

      <h2 id="overages">When the quota is exceeded</h2>
      <p className="text-muted-foreground">
        Calls return MCP error <code>QUOTA_EXCEEDED</code> with HTTP <code>429</code>. The
        gateway adds a <code>Retry-After</code> header pointing to the next reset.
      </p>

      <h2 id="upgrading">Upgrading</h2>
      <p className="text-muted-foreground">
        Open <code>Dashboard → Billing</code> to change plan. The new quota becomes
        effective immediately and is prorated for the current billing period.
      </p>
    </>
  );
}