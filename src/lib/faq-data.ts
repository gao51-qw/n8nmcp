export type FaqItem = { q: string; a: string };

export const FAQ: FaqItem[] = [
  {
    q: "How is n8n-mcp different from running n8n's MCP node myself?",
    a: "We host a multi-tenant MCP gateway in front of your n8n instance. You get a stable URL, per-tool routing, encrypted credential storage, usage quotas and observability — without exposing your n8n API key to AI clients.",
  },
  {
    q: "Which AI clients are supported?",
    a: "Anything that speaks the Model Context Protocol over Streamable HTTP — Claude, Claude Code, ChatGPT, Cursor, Windsurf, VS Code, Gemini CLI, Codex CLI, LM Studio, Continue, Cline, Zed and more.",
  },
  {
    q: "Is my n8n API key safe?",
    a: "Yes. Keys are encrypted at rest with AES-256-GCM before they touch the database. Decryption only happens in memory inside the gateway when forwarding a request to your instance.",
  },
  {
    q: "Do I need a paid plan to start?",
    a: "No. The Free tier includes 100 MCP calls per day and one n8n instance. No credit card required.",
  },
  {
    q: "Can I use this with a self-hosted n8n behind a private network?",
    a: "The gateway needs to reach your n8n HTTPS endpoint. If your n8n is on a private network you can expose it via a tunnel (Cloudflare Tunnel, Tailscale Funnel) or run the gateway inside the same network.",
  },
  {
    q: "Is the source available?",
    a: "The MCP knowledge server we use is open source. The hosted gateway code is closed for now but we publish detailed docs and the wire protocol is the official MCP spec — no lock-in.",
  },
];

export function buildFaqJsonLd(items: FaqItem[] = FAQ) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: items.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}
