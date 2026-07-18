import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, CalendarDays } from "lucide-react";
import { getBlogPosts } from "@/lib/blog-content.server";
import { canonicalUrl } from "@/lib/site-domains";

export const metadata: Metadata = {
  title: "Blog",
  description:
    "n8n-mcp blog posts about hosted MCP gateways, n8n workflow automation, GEO content and AI client operations.",
  alternates: { canonical: canonicalUrl("/", "blog") },
};

export default function BlogPage() {
  const posts = getBlogPosts();

  return (
    <main id="main" className="mx-auto max-w-5xl px-6 py-16">
      <div className="max-w-3xl">
        <h1 className="text-4xl font-bold">n8n-mcp blog</h1>
        <p className="mt-5 text-lg leading-8 text-muted-foreground">
          Product engineering notes, GEO-ready explainers and practical guidance for connecting n8n
          workflow automation to MCP-compatible AI clients.
        </p>
      </div>
      <div className="mt-10 grid gap-4">
        {posts.map((post) => (
          <article key={post.slug} className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5" />
              <time dateTime={post.date}>{post.date}</time>
              <span>by {post.author}</span>
            </div>
            <h2 className="mt-3 text-2xl font-semibold">{post.title}</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">{post.description}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {post.tags.map((tag) => (
                <span key={tag} className="rounded-full border border-border px-2 py-1 text-xs">
                  {tag}
                </span>
              ))}
            </div>
            <Link
              href={`/blog/${post.slug}`}
              className="mt-5 inline-flex items-center text-sm font-medium text-primary"
            >
              Read post <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </article>
        ))}
      </div>
    </main>
  );
}
