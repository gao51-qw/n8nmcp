import { createFileRoute } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";

const TITLE = "Terms of Service — n8n-mcp";
const DESC =
  "Terms of Service for n8n-mcp, the hosted Model Context Protocol gateway for n8n workflows. Account, billing, acceptable use and liability.";
const URL = "https://n8nmcp.lovable.app/terms";

export const Route = createFileRoute("/{-$locale}/terms")({
  head: ({ params }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
      { name: "twitter:title", content: TITLE },
      { name: "twitter:description", content: DESC },
      { name: "robots", content: "index,follow" },
    ],
    links: buildAlternateLinks("/terms", resolveLocale(params.locale)),
  }),
  component: Terms,
});

function Terms() {
  const updated = "May 11, 2026";
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight">Terms of Service</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

        <div className="prose prose-invert mt-10 max-w-none text-sm text-muted-foreground [&_h2]:mt-10 [&_h2]:text-foreground [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-3 [&_li]:mt-1 [&_a]:text-primary">
          <h2>1. Agreement</h2>
          <p>
            By creating an account or using n8n-mcp ("the Service") you agree to
            these Terms. If you do not agree, do not use the Service. We may
            update these Terms; continued use after changes constitutes
            acceptance.
          </p>

          <h2>2. The Service</h2>
          <p>
            n8n-mcp is a hosted Model Context Protocol gateway that connects
            your self-hosted or cloud n8n instances to MCP-compatible AI
            clients. We are not affiliated with or endorsed by n8n GmbH.
          </p>

          <h2>3. Accounts</h2>
          <p>
            You must be 16+ to use the Service. You are responsible for keeping
            your credentials and API keys secure. Notify us immediately of any
            unauthorized use.
          </p>

          <h2>4. Acceptable use</h2>
          <p>You agree not to:</p>
          <ul>
            <li>Use the Service to violate law or third-party rights;</li>
            <li>Attempt to disrupt, reverse engineer, or overload the Service;</li>
            <li>Send spam, malware, or abusive traffic through the gateway;</li>
            <li>Resell the Service without our written permission.</li>
          </ul>

          <h2>5. Plans, billing and refunds</h2>
          <p>
            Paid plans are billed in advance through Paddle, our merchant of
            record. Prices and quotas are described on the{" "}
            <a href="/pricing">Pricing</a> page. You can cancel any time; access
            continues until the end of the paid period. Refunds are issued at
            our discretion within 14 days of purchase if the Service did not
            work as described.
          </p>

          <h2>6. Your data and credentials</h2>
          <p>
            n8n API keys you store are encrypted at rest with AES-256-GCM. We
            decrypt them in memory only when forwarding requests to your n8n
            instance. We do not store the contents of workflow executions
            beyond what is required to operate quotas and audit logs. See the{" "}
            <a href="/privacy">Privacy Policy</a> for details.
          </p>

          <h2>7. Service availability</h2>
          <p>
            We aim for high availability but do not guarantee uninterrupted
            service on the Free tier. Paid plans may include availability
            commitments described separately.
          </p>

          <h2>8. Intellectual property</h2>
          <p>
            n8n-mcp branding, the gateway code and the user interface are owned
            by us. You retain all rights in your workflows, prompts and data.
            By using the Service you grant us a limited license to process that
            data solely to provide the Service.
          </p>

          <h2>9. Disclaimers</h2>
          <p>
            The Service is provided "as is" without warranties of any kind. AI
            outputs may be inaccurate; you are responsible for reviewing
            workflows before running them in production.
          </p>

          <h2>10. Limitation of liability</h2>
          <p>
            To the maximum extent permitted by law, our aggregate liability for
            any claim related to the Service is limited to the fees you paid in
            the 12 months preceding the claim, or USD 100, whichever is greater.
          </p>

          <h2>11. Termination</h2>
          <p>
            We may suspend or terminate accounts that violate these Terms.
            You may delete your account at any time from Settings.
          </p>

          <h2>12. Governing law</h2>
          <p>
            These Terms are governed by the laws of the jurisdiction in which
            the operator is established, excluding conflict-of-laws rules.
          </p>

          <h2>13. Contact</h2>
          <p>
            Questions about these Terms? Email{" "}
            <a href="mailto:hello@n8nmcp.app">hello@n8nmcp.app</a>.
          </p>
        </div>
      </article>
      <MarketingFooter />
    </div>
  );
}
