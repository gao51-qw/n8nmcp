import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { MarketingHeader } from "@/components/marketing-header";
import { MarketingFooter } from "@/components/marketing-footer";
import { Badge } from "@/components/ui/badge";
import { mdxComponents } from "@/components/mdx-components";
import { ArrowLeft } from "lucide-react";
import { formatPostDate, getPostBySlug } from "@/lib/blog";

const SITE = "https://n8nmcp.lovable.app";

export const Route = createFileRoute("/blog/$slug")({
  loader: ({ params }) => {
    const post = getPostBySlug(params.slug);
    if (!post) throw notFound();
    return post;
  },
  head: ({ loaderData }) => {
    if (!loaderData) return {};
    const TITLE = `${loaderData.title} — n8n-mcp blog`;
    const DESC = loaderData.description;
    const URL = `${SITE}/blog/${loaderData.slug}`;
    return {
      meta: [
        { title: TITLE },
        { name: "description", content: DESC },
        { property: "og:title", content: TITLE },
        { property: "og:description", content: DESC },
        { property: "og:url", content: URL },
        { property: "og:type", content: "article" },
        { property: "article:published_time", content: loaderData.date },
        ...(loaderData.author
          ? [{ property: "article:author", content: loaderData.author }]
          : []),
        { name: "twitter:title", content: TITLE },
        { name: "twitter:description", content: DESC },
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
            author: loaderData.author
              ? { "@type": "Person", name: loaderData.author }
              : undefined,
            mainEntityOfPage: URL,
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
  const post = Route.useLoaderData();
  const PostBody = post.Component;
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
      </main>
      <MarketingFooter />
    </div>
  );
}
