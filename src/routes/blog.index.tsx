import { createFileRoute, Link, notFound, stripSearchParams } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getAllPosts, formatPostDate } from "@/lib/blog";

const SITE = "https://n8nmcp.lovable.app";
const SITE_NAME = "n8n-mcp";
const PER_PAGE = 6;

type PostCard = {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string | undefined;
  tags: string[];
};

const searchSchema = z.object({
  page: fallback(z.number().int().min(1), 1).default(1),
});

export const Route = createFileRoute("/blog/")({
  validateSearch: zodValidator(searchSchema),
  search: {
    // Default page=1 should never appear in the URL — keep /blog clean.
    middlewares: [stripSearchParams({ page: 1 })],
  },
  loaderDeps: ({ search }) => ({ page: search.page }),
  loader: ({ deps }): {
    page: number;
    totalPages: number;
    totalPosts: number;
    posts: PostCard[];
  } => {
    const all = getAllPosts();
    const totalPages = Math.max(1, Math.ceil(all.length / PER_PAGE));
    if (deps.page > totalPages) throw notFound();
    const start = (deps.page - 1) * PER_PAGE;
    return {
      page: deps.page,
      totalPages,
      totalPosts: all.length,
      posts: all.slice(start, start + PER_PAGE).map((p) => ({
        slug: p.slug,
        title: p.title,
        description: p.description,
        date: p.date,
        author: p.author,
        tags: p.tags,
      })),
    };
  },
  head: ({ loaderData }) => {
    const TITLE = "Blog — n8n-mcp";
    const DESC =
      "Release notes, deep-dives and tutorials from the n8n-mcp team — building an MCP gateway for n8n.";
    const page = loaderData?.page ?? 1;
    const totalPages = loaderData?.totalPages ?? 1;
    const canonicalUrl = page === 1 ? `${SITE}/blog` : `${SITE}/blog?page=${page}`;
    const pageTitle = page === 1 ? TITLE : `${TITLE} — page ${page}`;
    const prevHref =
      page > 1
        ? page - 1 === 1
          ? `${SITE}/blog`
          : `${SITE}/blog?page=${page - 1}`
        : null;
    const nextHref =
      page < totalPages ? `${SITE}/blog?page=${page + 1}` : null;
    const posts = loaderData?.posts ?? [];
    return {
      meta: [
        { title: pageTitle },
        { name: "description", content: DESC },
        { property: "og:site_name", content: SITE_NAME },
        { property: "og:title", content: pageTitle },
        { property: "og:description", content: DESC },
        { property: "og:url", content: canonicalUrl },
        { property: "og:type", content: "website" },
        { name: "twitter:card", content: "summary" },
        { name: "twitter:title", content: pageTitle },
        { name: "twitter:description", content: DESC },
      ],
      links: [
        { rel: "canonical", href: canonicalUrl },
        ...(prevHref ? [{ rel: "prev", href: prevHref }] : []),
        ...(nextHref ? [{ rel: "next", href: nextHref }] : []),
      ],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "Blog",
            name: TITLE,
            description: DESC,
            url: `${SITE}/blog`,
            blogPost: posts.map((p) => ({
              "@type": "BlogPosting",
              headline: p.title,
              description: p.description,
              datePublished: p.date,
              url: `${SITE}/blog/${p.slug}`,
            })),
          }),
        },
      ],
    };
  },
  component: BlogIndex,
});

function BlogIndex() {
  const { posts, page, totalPages, totalPosts } = Route.useLoaderData();
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

        {totalPosts === 0 ? (
          <p className="mt-16 text-center text-sm text-muted-foreground">
            No posts yet — check back soon.
          </p>
        ) : (
          <>
          <ul className="mt-12 space-y-6">
            {posts.map((p: PostCard) => (
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
                      {p.tags.map((t: string) => (
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
          {totalPages > 1 && (
            <BlogPagination page={page} totalPages={totalPages} totalPosts={totalPosts} />
          )}
          </>
        )}
      </main>
      <MarketingFooter />
    </div>
  );
}

function BlogPagination({
  page,
  totalPages,
  totalPosts,
}: {
  page: number;
  totalPages: number;
  totalPosts: number;
}) {
  const pages = Array.from({ length: totalPages }, (_, i) => i + 1);
  const linkBase = cn(
    buttonVariants({ variant: "outline", size: "sm" }),
    "min-w-9",
  );
  const linkActive = cn(
    buttonVariants({ variant: "default", size: "sm" }),
    "min-w-9 pointer-events-none",
  );
  const linkDisabled = cn(
    buttonVariants({ variant: "outline", size: "sm" }),
    "pointer-events-none opacity-40",
  );

  const prevSearch = page - 1 === 1 ? {} : { page: page - 1 };
  const nextSearch = { page: page + 1 };

  return (
    <nav
      aria-label="Blog pagination"
      className="mt-10 flex flex-col items-center gap-3"
    >
      <ul className="flex flex-wrap items-center justify-center gap-1.5">
        <li>
          {page > 1 ? (
            <Link
              to="/blog"
              search={prevSearch}
              className={linkBase}
              aria-label="Previous page"
              rel="prev"
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
          ) : (
            <span className={linkDisabled} aria-disabled="true">
              <ChevronLeft className="h-4 w-4" />
            </span>
          )}
        </li>
        {pages.map((p) => (
          <li key={p}>
            <Link
              to="/blog"
              search={p === 1 ? {} : { page: p }}
              className={p === page ? linkActive : linkBase}
              aria-label={`Go to page ${p}`}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </Link>
          </li>
        ))}
        <li>
          {page < totalPages ? (
            <Link
              to="/blog"
              search={nextSearch}
              className={linkBase}
              aria-label="Next page"
              rel="next"
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          ) : (
            <span className={linkDisabled} aria-disabled="true">
              <ChevronRight className="h-4 w-4" />
            </span>
          )}
        </li>
      </ul>
      <p className="text-xs text-muted-foreground">
        Page {page} of {totalPages} · {totalPosts} posts
      </p>
    </nav>
  );
}
