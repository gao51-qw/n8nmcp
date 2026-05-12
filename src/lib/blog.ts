// MDX-file-based blog. Add a new file under src/content/blog/<slug>.mdx
// with the frontmatter shown below and it will appear automatically on
// /blog after the next deploy.
//
// Frontmatter (YAML at the top of the file):
//
//   ---
//   title: "Hello world"
//   description: "Short summary used for cards + SEO."
//   date: "2026-05-12"
//   author: "Your name"
//   tags: ["tag-a", "tag-b"]
//   ---
//
// Then write the body in MDX — plain markdown PLUS any React component
// you import at the top of the file.

import type { ComponentType } from "react";

// MDX default export accepts a `components` map keyed by tag name. Using `any`
// in the value position keeps the prop types of each component (h1, p, code …)
// intact when callers pass `mdxComponents`.
type MDXContent = ComponentType<{ components?: Record<string, ComponentType<any>> }>;

type MdxModule = {
  default: MDXContent;
  frontmatter?: {
    title?: string;
    description?: string;
    date?: string;
    updated?: string;
    author?: string;
    tags?: string[];
    cover?: string;
    image?: string;
  };
};

const MDX_MODULES = import.meta.glob<MdxModule>("../content/blog/*.mdx", {
  eager: true,
});

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  author?: string;
  tags: string[];
  cover?: string;
  Component: MDXContent;
};

const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function slugFromPath(p: string): string {
  const file = p.split("/").pop() ?? p;
  return file.replace(/\.mdx$/, "");
}

const POSTS: BlogPost[] = Object.entries(MDX_MODULES)
  .map(([path, mod]) => {
    const fm = mod.frontmatter ?? {};
    const slug = slugFromPath(path);
    if (!SLUG_RE.test(slug)) {
      throw new Error(
        `Blog post filename "${slug}.mdx" is not a valid URL slug. ` +
          `Use lowercase letters, numbers and hyphens only (e.g. my-great-post.mdx).`,
      );
    }
    if (!fm.title) {
      throw new Error(`Blog post "${slug}.mdx" is missing a "title" in frontmatter.`);
    }
    if (!fm.description) {
      throw new Error(
        `Blog post "${slug}.mdx" is missing a "description" in frontmatter (used for SEO + share previews).`,
      );
    }
    return {
      slug,
      title: fm.title,
      description: fm.description,
      date: fm.date ?? "1970-01-01",
      updated: fm.updated,
      author: fm.author,
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      cover: fm.cover ?? fm.image,
      Component: mod.default,
    } satisfies BlogPost;
  })
  // Stable order: newest date first, ties broken alphabetically by slug.
  // This makes the listing deterministic across builds even when two posts
  // share the same date.
  .sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return a.slug < b.slug ? -1 : 1;
  });

export function getAllPosts(): BlogPost[] {
  return POSTS;
}

export function getPostBySlug(slug: string): BlogPost | undefined {
  return POSTS.find((p) => p.slug === slug);
}

export function formatPostDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}
