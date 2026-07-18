import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { getBlogPost, getBlogPosts } from "@/lib/blog-content.server";
import { canonicalUrl } from "@/lib/site-domains";

type PageProps = {
  params: Promise<{ slug: string }>;
};

export function generateStaticParams() {
  return getBlogPosts().map((post) => ({ slug: post.slug }));
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return {};

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: canonicalUrl(`/${post.slug}`, "blog") },
    openGraph: {
      title: post.title,
      description: post.description,
      url: canonicalUrl(`/${post.slug}`, "blog"),
      type: "article",
    },
  };
}

function stripMdxImports(body: string): string {
  return body
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("import "))
    .join("\n")
    .replace(/<[^>]+>/g, "")
    .trim();
}

export default async function BlogPostPage({ params }: PageProps) {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const paragraphs = stripMdxImports(post.body)
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  return (
    <main id="main" className="mx-auto max-w-3xl px-6 py-16">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <CalendarDays className="h-3.5 w-3.5" />
        <time dateTime={post.date}>{post.date}</time>
        <span>by {post.author}</span>
      </div>
      <h1 className="mt-4 text-4xl font-bold">{post.title}</h1>
      <p className="mt-5 text-lg leading-8 text-muted-foreground">{post.description}</p>
      <div className="mt-5 flex flex-wrap gap-2">
        {post.tags.map((tag) => (
          <span key={tag} className="rounded-full border border-border px-2 py-1 text-xs">
            {tag}
          </span>
        ))}
      </div>
      <article className="mt-10 space-y-5 text-base leading-8 text-muted-foreground">
        {paragraphs.map((paragraph) =>
          paragraph.startsWith("## ") ? (
            <h2 key={paragraph} className="pt-4 text-2xl font-semibold text-foreground">
              {paragraph.replace(/^##\s+/, "")}
            </h2>
          ) : (
            <p key={paragraph}>{paragraph}</p>
          ),
        )}
      </article>
    </main>
  );
}
