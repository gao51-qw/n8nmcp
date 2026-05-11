import { createFileRoute } from "@tanstack/react-router";

const SITE = "https://n8nmcp.lovable.app";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET: () => {
        const body =
          `User-agent: *\n` +
          `Allow: /\n` +
          `Disallow: /api/\n` +
          `Disallow: /dashboard\n` +
          `Disallow: /settings\n` +
          `Disallow: /billing\n` +
          `Disallow: /api-keys\n` +
          `Disallow: /instances\n` +
          `Disallow: /usage\n` +
          `Disallow: /chat\n` +
          `Disallow: /connect\n` +
          `Disallow: /admin\n` +
          `\n` +
          `Sitemap: ${SITE}/sitemap.xml\n`;

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
