import type { MetadataRoute } from "next";
import type { SiteSurface } from "@/lib/site-domains";

export const homepageFaq = [
  {
    q: "What is n8n-mcp?",
    a: "n8n-mcp is a hosted Model Context Protocol gateway for connecting self-hosted n8n workflows to AI clients.",
  },
  {
    q: "Do I need to expose my n8n API key to AI clients?",
    a: "No. n8n API keys are stored by the gateway and encrypted at rest; AI clients authenticate with a platform API key.",
  },
  {
    q: "Which AI clients are supported?",
    a: "Any MCP-compatible client can connect, including Claude, ChatGPT, Cursor, Windsurf, VS Code and Zed.",
  },
  {
    q: "How is n8n-mcp different from a local MCP server?",
    a: "A local MCP server runs beside one client, while n8n-mcp provides a hosted gateway URL, per-user authentication, encrypted n8n credential storage and centralized request controls.",
  },
] as const;

export const answerBlock =
  "n8n-mcp is a hosted Model Context Protocol gateway for teams that run self-hosted n8n. It gives AI clients such as Claude, ChatGPT, Cursor, Windsurf, VS Code and Zed a stable MCP endpoint for workflow operations. Instead of giving every AI client direct n8n access, users connect an n8n instance once, store the n8n API key in the gateway, and authenticate clients with a platform API key. AI agents can then list workflows, inspect workflow details, create or update automations, validate workflow structure, execute workflows and review execution history. The gateway is designed for automation teams that want AI-assisted workflow operations while keeping credentials, tenant routing, rate limits and outbound request protection in one server-side boundary.";

export type SeoPage = {
  path: string;
  title: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
};

export const activeSeoPagesBySurface: Record<Exclude<SiteSurface, "dashboard">, SeoPage[]> = {
  mcp: [
    { path: "/", title: "n8n-mcp homepage", priority: 1, changeFrequency: "weekly" },
    { path: "/pricing", title: "Pricing", priority: 0.7, changeFrequency: "monthly" },
    { path: "/llms.txt", title: "LLM text index", priority: 0.4, changeFrequency: "weekly" },
  ],
  docs: [
    { path: "/", title: "Documentation overview", priority: 0.8, changeFrequency: "weekly" },
    {
      path: "/getting-started",
      title: "Getting started guide",
      priority: 0.75,
      changeFrequency: "monthly",
    },
    {
      path: "/security",
      title: "Security documentation",
      priority: 0.75,
      changeFrequency: "monthly",
    },
    { path: "/faq", title: "FAQ", priority: 0.65, changeFrequency: "monthly" },
    { path: "/tools", title: "MCP tools reference", priority: 0.75, changeFrequency: "weekly" },
    { path: "/llms.txt", title: "LLM text index", priority: 0.4, changeFrequency: "weekly" },
  ],
  blog: [
    { path: "/", title: "n8n-mcp blog", priority: 0.8, changeFrequency: "weekly" },
    { path: "/llms.txt", title: "LLM text index", priority: 0.4, changeFrequency: "weekly" },
  ],
};
