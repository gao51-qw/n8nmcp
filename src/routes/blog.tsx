import { createFileRoute, Link } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import { Badge } from "@/components/ui/badge";
import { getAllPosts, formatPostDate } from "@/lib/blog";

const SITE = "https://n8nmcp.lovable.app";

export const Route = createFileRoute("/blog")({
  head: () => {
    const TITLE = "Blog — n8n-mcp";
    const DESC =
      "Release notes, deep-dives and tutorials from the n8n-mcp team — building an MCP gateway for n8n.";
    const URL = `${SITE}/blog`;
    return {
      meta: [
        { title: TITLE },
        { name: "description", content: DESC },
        { property: "og:title", content: TITLE },
        { property: "og:description", content: DESC },
        { property: "og:url", content: URL },
        { property: "og:type", content: "website" },
        { name: "twitter:title", content: TITLE },
        { name: "twitter:description", content: DESC },
      ],
      links: [{ rel: "canonical", href: URL }],
    };
  },
  component: BlogIndex,
});

function BlogIndex() {
  const posts = getAllPosts();
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-6 py-16">
        <div className="text-center">
          <p className="text-xs uppercase tracking-widest text-primary">Blog</p>
          <h1 className="mt-3 text-4xl font-bold tracking-tight md:text-5xl">
            Notes from the n8n-mcp team
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            Release notes, architectural deep-dives and tutorials.
          </p>
        </div>

        {posts.length === 0 ? (
          <p className="mt-16 text-center text-sm text-muted-foreground">
            No posts yet — check back soon.
          </p>
        ) : (
          <ul className="mt-12 space-y-6">
            {posts.map((p) => (
              <li key={p.slug}>
                <Link
                  to="/blog/$slug"
                  params={{ slug: p.slug }}
                  className="block rounded-2xl border border-border bg-card p-6 transition-colors hover:border-primary/40"
                >
                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <time dateTime={p.date}>{formatPostDate(p.date)}</time>
                    {p.author && (
                      <>
                        <span aria-hidden>·</span>
                        <span>{p.author}</span>
                      </>
                    )}
                  </div>
                  <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground">
                    {p.title}
                  </h2>
                  {p.description && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                  {p.tags.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-1.5">
                      {p.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[10px]">
                          #{t}
                        </Badge>
                      ))}
                    </div>
                  )}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}
