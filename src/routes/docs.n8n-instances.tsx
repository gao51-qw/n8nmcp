import { createFileRoute } from "@tanstack/react-router";

const TITLE = "n8n instances — n8n-mcp docs";
const DESC = "Connect your self-hosted or n8n.cloud instance, store API keys encrypted, and protect against SSRF.";
const URL = "https://n8nmcp.lovable.app/docs/n8n-instances";

export const Route = createFileRoute("/docs/n8n-instances")({
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
  }),
  component: Page,
});

function Page() {
  return (
    <>
      <h1>n8n instances</h1>
      <p className="text-muted-foreground">
        An <strong>instance</strong> is a single n8n deployment the gateway can talk to.
        You can register one (n8n.cloud) or many (per-environment self-hosted).
      </p>

      <h2 id="add">Add an instance</h2>
      <ol className="text-muted-foreground">
        <li>Open <code>Dashboard → n8n instances → New instance</code>.</li>
        <li>Give it a label (e.g. <code>prod</code>, <code>staging</code>).</li>
        <li>
          Paste the <strong>base URL</strong> of your n8n (no trailing
          <code>/rest</code>). Examples: <code>https://n8n.example.com</code>,
          <code>https://your-tenant.app.n8n.cloud</code>.
        </li>
        <li>
          Paste an <strong>n8n API key</strong> created from{" "}
          <code>n8n → Settings → n8n API → Create API key</code>.
        </li>
      </ol>

      <h2 id="encryption">How keys are stored</h2>
      <p className="text-muted-foreground">
        n8n API keys are encrypted at rest with a server-side key. They are decrypted
        in-memory only when the gateway proxies a request, and never returned to clients
        after the initial save.
      </p>

      <h2 id="ssrf">SSRF protection</h2>
      <p className="text-muted-foreground">
        The gateway runs <code>assertPublicUrl()</code> on every instance URL before any
        outbound request. URLs that resolve to private/loopback ranges
        (<code>127.0.0.0/8</code>, <code>10.0.0.0/8</code>, <code>172.16.0.0/12</code>,
        <code>192.168.0.0/16</code>, IPv6 link-local, etc.) are rejected. If you self-host
        n8n on a private network, expose it through a public hostname or reverse proxy.
      </p>

      <h2 id="health">Health checks</h2>
      <p className="text-muted-foreground">
        Each instance row shows the last successful contact and the most recent error.
        Click <strong>Test connection</strong> to re-run <code>GET /rest/login</code>
        without changing anything.
      </p>

      <h2 id="multiple">Targeting a specific instance</h2>
      <p className="text-muted-foreground">
        When more than one instance is registered, MCP tool calls accept an
        <code>instance</code> parameter (the label). Without it, the workspace default
        instance is used.
      </p>

      <h2 id="rotate">Rotating an n8n key</h2>
      <p className="text-muted-foreground">
        Generate a new key in n8n, paste it on the instance row, and save. The previous
        ciphertext is overwritten immediately.
      </p>
    </>
  );
}