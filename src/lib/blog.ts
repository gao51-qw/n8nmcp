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

type MdxModule = {
  default: ComponentType<{ components?: Record<string, ComponentType<unknown>> }>;
  frontmatter?: {
    title?: string;
    description?: string;
    date?: string;
    author?: string;
    tags?: string[];
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
  author?: string;
  tags: string[];
  Component: MdxModule["default"];
};

function slugFromPath(p: string): string {
  const file = p.split("/").pop() ?? p;
  return file.replace(/\.mdx$/, "");
}

const POSTS: BlogPost[] = Object.entries(MDX_MODULES)
  .map(([path, mod]) => {
    const fm = mod.frontmatter ?? {};
    const slug = slugFromPath(path);
    return {
      slug,
      title: fm.title ?? slug,
      description: fm.description ?? "",
      date: fm.date ?? "1970-01-01",
      author: fm.author,
      tags: Array.isArray(fm.tags) ? fm.tags : [],
      Component: mod.default,
    } satisfies BlogPost;
  })
  .sort((a, b) => (a.date < b.date ? 1 : -1));

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
