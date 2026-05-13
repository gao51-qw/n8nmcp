import { createFileRoute } from "@tanstack/react-router";
import { buildBreadcrumbJsonLd, buildDocsTechArticleJsonLd } from "@/lib/seo-jsonld";
import { buildAlternateLinks, resolveLocale } from "@/lib/seo-i18n";

const TITLE = "Security — n8n-mcp docs";
const DESC = "Encryption at rest, SSRF protection, RLS policies, and the gateway's threat model.";
const URL = "https://n8nmcp.lovable.app/docs/security";

export const Route = createFileRoute("/{-$locale}/docs/security")({
  head: ({ params }) => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:url", content: URL },
      { property: "og:type", content: "article" },
    ],
    links: buildAlternateLinks("/docs/security", resolveLocale(params.locale)),
    scripts: [
      {
        type: "application/ld+json",
        children: buildDocsTechArticleJsonLd({ title: TITLE, description: DESC, path: '/docs/security' }),
      },
      {
        type: "application/ld+json",
        children: buildBreadcrumbJsonLd([{ name: "Home", path: "/" }, { name: "Docs", path: "/docs" }, { name: 'Security', path: '/docs/security' }]),
      },
    ],
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <h1>Security</h1>
      <p className="text-muted-foreground">
        The gateway brokers MCP traffic between AI clients and your n8n. It is designed
        so that a compromised platform key cannot reach private networks, exfiltrate
        other tenants&rsquo; data, or escalate to admin.
      </p>

      <h2 id="key-storage">Credential storage</h2>
      <ul className="text-muted-foreground">
        <li>
          <strong>Platform API keys</strong> (<code>nmcp_&hellip;</code>) are hashed with
          SHA-256 before storage. Only a <code>last4</code> hint is kept for display.
        </li>
        <li>
          <strong>n8n API keys</strong> are encrypted at rest with a server-side key
          (AES-GCM). Plaintext only exists in memory during a proxied request.
        </li>
        <li>Service-role database access is server-only; the browser never sees it.</li>
      </ul>

      <h2 id="ssrf">SSRF guard</h2>
      <p className="text-muted-foreground">
        Every user-controlled URL the server resolves passes through
        <code>assertPublicUrl()</code>. It rejects:
      </p>
      <ul className="text-muted-foreground">
        <li>Loopback addresses (<code>127.0.0.0/8</code>, <code>::1</code>).</li>
        <li>RFC1918 private ranges and link-local IPv4/IPv6.</li>
        <li>Cloud metadata endpoints (<code>169.254.169.254</code>, GCP/Azure equivalents).</li>
        <li>Non-<code>http(s)</code> schemes (<code>file:</code>, <code>gopher:</code>&hellip;).</li>
        <li>DNS rebinding — names are resolved and the resolved IP is re-checked.</li>
      </ul>

      <h2 id="rls">Row-level security</h2>
      <p className="text-muted-foreground">
        Tenant data (workspaces, API keys, n8n instances, audit logs) is protected by
        Postgres RLS scoped to <code>auth.uid()</code>. Admin tables (roles, audit,
        secrets) are explicitly excluded from the realtime publication.
      </p>

      <h2 id="roles">Roles &amp; admin</h2>
      <p className="text-muted-foreground">
        Roles live in a dedicated <code>user_roles</code> table and are checked via the
        <code>has_role()</code> security-definer function. Admin role is never derived from
        client storage.
      </p>

      <h2 id="errors">Error sanitization</h2>
      <p className="text-muted-foreground">
        Server functions catch upstream errors and return generic, user-safe messages.
        Stack traces and edge-runtime exceptions are logged server-side only.
      </p>

      <h2 id="reporting">Reporting a vulnerability</h2>
      <p className="text-muted-foreground">
        Email <code>security@n8nmcp.lovable.app</code> with reproduction steps. Please do
        not open public issues for security reports.
      </p>
    </>
  );
}