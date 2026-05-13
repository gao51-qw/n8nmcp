import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import { Badge } from "@/components/ui/badge";
import { mdxComponents } from "@/components/mdx-components";
import { ShareButtons } from "@/components/share-buttons";
import { ArrowLeft } from "lucide-react";
import { formatPostDate, getPostBySlug } from "@/lib/blog";

const SITE = "https://n8nmcp.lovable.app";
const SITE_NAME = "n8n-mcp";

function absoluteUrl(maybeRelative: string): string {
  if (/^https?:\/\//i.test(maybeRelative)) return maybeRelative;
  return `${SITE}${maybeRelative.startsWith("/") ? "" : "/"}${maybeRelative}`;
}

export const Route = createFileRoute("/blog/$slug")({
  // Blog posts are bundled at build time — the data never changes between
  // navigations, so cache the loader result forever.
  staleTime: Infinity,
  gcTime: Infinity,
  loader: ({ params }) => {
    const post = getPostBySlug(params.slug);
    if (!post) throw notFound();
    // The MDX component itself is not serializable for SSR loader hydration —
    // return only the metadata and re-resolve the component from params in the
    // page body. Both the loader and the component run in the same bundle, so
    // the in-memory POSTS list is identical.
    return {
      slug: post.slug,
      title: post.title,
      description: post.description,
      date: post.date,
      updated: post.updated,
      author: post.author,
      tags: post.tags,
      cover: post.cover,
    };
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const TITLE = `${loaderData.title} — n8n-mcp blog`;
    const DESC = loaderData.description;
    const URL = `${SITE}/blog/${loaderData.slug}`;
    const IMAGE = loaderData.cover ? absoluteUrl(loaderData.cover) : undefined;
    return {
      meta: [
        { title: TITLE },
        { name: "description", content: DESC },
        { property: "og:site_name", content: SITE_NAME },
        { property: "og:title", content: TITLE },
        { property: "og:description", content: DESC },
        { property: "og:url", content: URL },
        { property: "og:type", content: "article" },
        { property: "article:published_time", content: loaderData.date },
        ...(loaderData.updated
          ? [{ property: "article:modified_time", content: loaderData.updated }]
          : []),
        ...(loaderData.author
          ? [{ property: "article:author", content: loaderData.author }]
          : []),
        ...loaderData.tags.map((tag: string) => ({
          property: "article:tag",
          content: tag,
        })),
        ...(IMAGE
          ? [
              { property: "og:image", content: IMAGE },
              { property: "og:image:alt", content: loaderData.title },
            ]
          : []),
        {
          name: "twitter:card",
          content: IMAGE ? "summary_large_image" : "summary",
        },
        { name: "twitter:title", content: TITLE },
        { name: "twitter:description", content: DESC },
        ...(IMAGE ? [{ name: "twitter:image", content: IMAGE }] : []),
      ],
      links: [{ rel: "canonical", href: URL }],
      scripts: [
        {
          type: "application/ld+json",
          children: JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            headline: loaderData.title,
            description: loaderData.description,
            datePublished: loaderData.date,
            dateModified: loaderData.updated ?? loaderData.date,
            ...(IMAGE ? { image: IMAGE } : {}),
            keywords: loaderData.tags.join(", ") || undefined,
            author: loaderData.author
              ? { "@type": "Person", name: loaderData.author }
              : undefined,
            mainEntityOfPage: URL,
            publisher: {
              "@type": "Organization",
              name: SITE_NAME,
              url: SITE,
            },
          }),
        },
      ],
    };
  },
  component: BlogPostPage,
  notFoundComponent: () => (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-3xl font-bold">Post not found</h1>
        <p className="mt-3 text-muted-foreground">
          That article doesn't exist (yet).
        </p>
        <Link
          to="/blog"
          className="mt-6 inline-flex items-center gap-2 text-primary hover:underline"
        >
          <ArrowLeft className="h-4 w-4" /> Back to blog
        </Link>
      </main>
      <MarketingFooter />
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="mx-auto max-w-3xl px-6 py-24 text-center">
        <h1 className="text-3xl font-bold">Something went wrong</h1>
        <p className="mt-3 text-sm text-muted-foreground">{error.message}</p>
      </main>
      <MarketingFooter />
    </div>
  ),
});

function BlogPostPage() {
  const meta = Route.useLoaderData();
  const post = getPostBySlug(meta.slug)!;
  const PostBody = post.Component;
  const url = `${SITE}/blog/${post.slug}`;
  return (
    <div className="min-h-screen">
      <MarketingHeader />
      <main className="mx-auto max-w-2xl px-6 py-16">
        <Link
          to="/blog"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> All posts
        </Link>

        <header className="mt-6 border-b border-border pb-6">
          <h1 className="text-3xl font-bold tracking-tight md:text-4xl">
            {post.title}
          </h1>
          {post.description && (
            <p className="mt-3 text-base text-muted-foreground">
              {post.description}
            </p>
          )}
          <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <time dateTime={post.date}>{formatPostDate(post.date)}</time>
            {post.author && (
              <>
                <span aria-hidden>·</span>
                <span>{post.author}</span>
              </>
            )}
            {post.tags.length > 0 && (
              <div className="ml-1 flex flex-wrap gap-1.5">
                {post.tags.map((t: string) => (
                  <Badge key={t} variant="secondary" className="text-[10px]">
                    #{t}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        </header>

        <article className="mt-8">
          <PostBody components={mdxComponents} />
        </article>

        <footer className="mt-12 rounded-xl border border-border bg-card/50 p-5">
          <p className="text-sm font-medium text-foreground">
            Found this useful?
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Share it with someone who'd want to read it.
          </p>
          <div className="mt-4">
            <ShareButtons
              url={url}
              title={post.title}
              description={post.description}
              hashtags={["n8n", "MCP"]}
            />
          </div>
        </footer>
      </main>
      <MarketingFooter />
    </div>
  );
}
