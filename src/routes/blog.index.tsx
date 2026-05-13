import { createFileRoute, Link, notFound, stripSearchParams, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getAllPosts, getAllTags, formatPostDate } from "@/lib/blog";

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
  q: fallback(z.string(), "").default(""),
  tags: fallback(z.array(z.string()), []).default([]),
});
type BlogSearch = z.infer<typeof searchSchema>;

export const Route = createFileRoute("/blog/")({
  validateSearch: zodValidator(searchSchema),
  search: {
    // Strip default values so /blog stays clean.
    middlewares: [stripSearchParams({ page: 1, q: "", tags: [] })],
  },
  loaderDeps: ({ search }) => ({ page: search.page, q: search.q, tags: search.tags }),
  // Blog index is built from a bundled, build-time-static post list, so the
  // loader output for a given (page, q, tags) tuple is invariant. Cache
  // forever; pagination/search changes hit a different cache entry.
  staleTime: Infinity,
  gcTime: Infinity,
  loader: ({ deps }): {
    page: number;
    totalPages: number;
    totalPosts: number;
    totalAll: number;
    q: string;
    tags: string[];
    allTags: { tag: string; count: number }[];
    posts: PostCard[];
  } => {
    const all = getAllPosts();
    const allTags = getAllTags();
    const q = deps.q.trim().toLowerCase();
    const selectedTags = deps.tags.map((t) => t.trim().toLowerCase()).filter(Boolean);
    const filtered = all.filter((p) => {
      if (selectedTags.length > 0) {
        const postTags = p.tags.map((t) => t.toLowerCase());
        // AND semantics: post must include every selected tag.
        if (!selectedTags.every((t) => postTags.includes(t))) return false;
      }
      if (q) {
        const hay = `${p.title} ${p.description} ${p.tags.join(" ")}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
    if (deps.page > totalPages) throw notFound();
    const start = (deps.page - 1) * PER_PAGE;
    return {
      page: deps.page,
      totalPages,
      totalPosts: filtered.length,
      totalAll: all.length,
      q: deps.q,
      tags: deps.tags,
      allTags,
      posts: filtered.slice(start, start + PER_PAGE).map((p) => ({
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
  const { posts, page, totalPages, totalPosts, totalAll, q, tags, allTags } =
    Route.useLoaderData();
  const navigate = useNavigate({ from: "/blog" });
  const [query, setQuery] = useState(q);

  // Sync local input when URL changes (back/forward, tag click, clear).
  useEffect(() => {
    setQuery(q);
  }, [q]);

  // Debounced URL update on typing.
  useEffect(() => {
    if (query === q) return;
    const id = setTimeout(() => {
      navigate({
        search: (prev: BlogSearch) => ({
          ...prev,
          q: query,
          page: 1,
        }),
        replace: true,
      });
    }, 250);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const selectedSet = new Set(tags.map((t: string) => t.toLowerCase()));
  const hasFilter = q !== "" || tags.length > 0;

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

        {totalAll === 0 ? (
          <p className="mt-16 text-center text-sm text-muted-foreground">
            No posts yet — check back soon.
          </p>
        ) : (
          <>
          <div className="mt-10 space-y-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search posts by title, description or tag…"
                aria-label="Search blog posts"
                className="pl-9 pr-9"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery("")}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            {allTags.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5">
              <Link
                  to="/blog"
                search={(prev: BlogSearch) => ({ ...prev, tags: [], page: 1 })}
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs transition-colors",
                    tags.length === 0
                      ? "border-primary bg-primary text-primary-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  All
                </Link>
                {allTags.map(({ tag: t, count }: { tag: string; count: number }) => {
                  const active = selectedSet.has(t.toLowerCase());
                  return (
                    <Link
                      key={t}
                      to="/blog"
                      search={(prev: BlogSearch) => {
                        const lower = t.toLowerCase();
                        const next = active
                          ? prev.tags.filter((x) => x.toLowerCase() !== lower)
                          : [...prev.tags, t];
                        return { ...prev, tags: next, page: 1 };
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        active
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                      )}
                      aria-pressed={active}
                    >
                      #{t}
                      <span className="ml-1 opacity-60">{count}</span>
                    </Link>
                  );
                })}
              </div>
            )}
          </div>

          {posts.length === 0 ? (
            <div className="mt-12 rounded-2xl border border-dashed border-border p-10 text-center">
              <p className="text-sm text-muted-foreground">
                No posts match your filters.
              </p>
              {hasFilter && (
                <Link
                  to="/blog"
                  search={{}}
                  className={cn(
                    buttonVariants({ variant: "outline", size: "sm" }),
                    "mt-4",
                  )}
                >
                  Clear filters
                </Link>
              )}
            </div>
          ) : (
          <ul className="mt-8 space-y-6">
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
                    <HighlightText text={p.title} query={q} />
                  </h2>
                  {p.description && (
                    <p className="mt-2 text-sm text-muted-foreground">
                      <HighlightText text={p.description} query={q} />
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
          )}
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
              search={(prev: BlogSearch) => ({ ...prev, page: page - 1 })}
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
              search={(prev: BlogSearch) => ({ ...prev, page: p })}
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
              search={(prev: BlogSearch) => ({ ...prev, page: page + 1 })}
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

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function HighlightText({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) return <>{text}</>;
  const re = new RegExp(`(${escapeRegExp(q)})`, "ig");
  const parts = text.split(re);
  return (
    <>
      {parts.map((part, i) =>
        i % 2 === 1 ? (
          <mark
            key={i}
            className="rounded-sm bg-primary/15 px-0.5 text-foreground"
          >
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
