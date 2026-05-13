import { createFileRoute } from "@tanstack/react-router";

const SITE = "https://n8nmcp.lovable.app";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => {
        const privateDisallows = [
          "/api/",
          "/dashboard",
          "/settings",
          "/billing",
          "/api-keys",
          "/instances",
          "/usage",
          "/chat",
          "/connect",
          "/admin",
        ];
        // Explicitly allow major AI / search crawlers so they don't fall back
        // to a conservative default. Each block reiterates the private
        // disallows so a bot that only reads its own User-agent section still
        // skips the authenticated app surface.
        const aiBots = [
          "GPTBot",
          "ChatGPT-User",
          "OAI-SearchBot",
          "ClaudeBot",
          "anthropic-ai",
          "Claude-Web",
          "PerplexityBot",
          "Perplexity-User",
          "Google-Extended",
          "GoogleOther",
          "CCBot",
          "Applebot-Extended",
          "cohere-ai",
          "Bytespider",
        ];
        const block = (ua: string) =>
          `User-agent: ${ua}\nAllow: /\n${privateDisallows
            .map((p) => `Disallow: ${p}`)
            .join("\n")}\n`;
        const body =
          block("*") +
          "\n" +
          aiBots.map((b) => block(b)).join("\n") +
          `\nSitemap: ${SITE}/sitemap.xml\n`;

        return new Response(body, {
          headers: {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
