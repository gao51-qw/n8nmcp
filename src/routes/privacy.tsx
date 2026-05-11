import { createFileRoute } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";

export const Route = createFileRoute("/privacy")({
  head: () => ({
    meta: [
      { title: "Privacy Policy — n8n-mcp" },
      {
        name: "description",
        content:
          "How n8n-mcp collects, uses and protects your data, credentials and workflow metadata.",
      },
    ],
  }),
  component: Privacy,
});

function Privacy() {
  const updated = "May 11, 2026";
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <article className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-4xl font-bold tracking-tight">Privacy Policy</h1>
        <p className="mt-2 text-sm text-muted-foreground">Last updated: {updated}</p>

        <div className="prose prose-invert mt-10 max-w-none text-sm text-muted-foreground [&_h2]:mt-10 [&_h2]:text-foreground [&_h2]:text-xl [&_h2]:font-semibold [&_p]:mt-3 [&_li]:mt-1 [&_a]:text-primary">
          <h2>1. What we collect</h2>
          <ul>
            <li><strong>Account data</strong>: email, hashed password (or OAuth identifier).</li>
            <li><strong>Connection data</strong>: n8n instance URLs and API keys you submit. Keys are encrypted at rest with AES-256-GCM.</li>
            <li><strong>Usage data</strong>: tool call counts, timestamps, error codes — used for quotas and abuse prevention.</li>
            <li><strong>Billing data</strong>: handled by Paddle; we receive only the customer ID, country and subscription state.</li>
          </ul>

          <h2>2. What we do not store</h2>
          <p>
            We do not persist the body of MCP tool calls or the data flowing
            through your n8n executions. Requests are proxied in memory and
            discarded after the response is returned.
          </p>

          <h2>3. Why we process data</h2>
          <ul>
            <li>To operate the Service (route MCP calls to your n8n instance);</li>
            <li>To enforce quotas and prevent abuse;</li>
            <li>To bill paid plans through Paddle;</li>
            <li>To send essential service emails (verification, security, billing).</li>
          </ul>

          <h2>4. Sharing</h2>
          <p>We do not sell your data. We share limited data with these processors:</p>
          <ul>
            <li><strong>Supabase</strong> — managed Postgres and authentication;</li>
            <li><strong>Paddle</strong> — billing, tax and merchant of record;</li>
            <li><strong>Cloud hosting providers</strong> — to run the gateway and database.</li>
          </ul>

          <h2>5. Cookies <a id="cookies" /></h2>
          <p>
            We use a small number of strictly necessary cookies for
            authentication and CSRF protection. We do not use third-party
            advertising cookies or cross-site trackers.
          </p>

          <h2>6. Data retention</h2>
          <p>
            Account and connection data are retained while your account is
            active. Usage logs are retained for up to 90 days. When you delete
            your account, all personal data and stored credentials are removed
            within 30 days, except where required by law (e.g. invoicing).
          </p>

          <h2>7. Your rights</h2>
          <p>
            You can access, export or delete your data from Settings, or by
            emailing <a href="mailto:hello@n8nmcp.app">hello@n8nmcp.app</a>. If
            you are in the EEA / UK, you have the right to lodge a complaint
            with your local data protection authority.
          </p>

          <h2>8. Security</h2>
          <p>
            All traffic is TLS encrypted. Credentials are encrypted at rest.
            Access to production systems is restricted and audited. No system
            is perfectly secure — please report vulnerabilities to{" "}
            <a href="mailto:security@n8nmcp.app">security@n8nmcp.app</a>.
          </p>

          <h2>9. Children</h2>
          <p>
            The Service is not directed at children under 16 and we do not
            knowingly collect data from them.
          </p>

          <h2>10. Changes</h2>
          <p>
            We will post material changes to this policy on this page and
            update the "Last updated" date.
          </p>

          <h2>11. Contact</h2>
          <p>
            Questions? Email{" "}
            <a href="mailto:hello@n8nmcp.app">hello@n8nmcp.app</a>.
          </p>
        </div>
      </article>
      <MarketingFooter />
    </div>
  );
}
