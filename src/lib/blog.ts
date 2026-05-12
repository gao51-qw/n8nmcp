// Markdown-file-based blog. Add a new file under src/content/blog/*.md
// with the frontmatter shown below and it will appear automatically on
// /blog after the next deploy.
//
// Frontmatter:
//   ---
//   title: "Hello world"
//   description: "Short summary used for cards + SEO."
//   date: "2026-05-12"
//   author: "Your name"
//   tags: ["tag-a", "tag-b"]
//   ---
//   Body in **markdown**…

const RAW_POSTS = import.meta.glob("../content/blog/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string; // ISO yyyy-mm-dd
  author?: string;
  tags: string[];
  body: string;
};

function parseFrontmatter(raw: string): { meta: Record<string, unknown>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(raw);
  if (!m) return { meta: {}, body: raw };
  const meta: Record<string, unknown> = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1];
    let value: string = kv[2].trim();
    // Array literal: ["a","b"] or [a, b]
    if (value.startsWith("[") && value.endsWith("]")) {
      meta[key] = value
        .slice(1, -1)
        .split(",")
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter(Boolean);
      continue;
    }
    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    meta[key] = value;
  }
  return { meta, body: m[2] };
}

function slugFromPath(p: string): string {
  const file = p.split("/").pop() ?? p;
  return file.replace(/\.md$/, "");
}

const POSTS: BlogPost[] = Object.entries(RAW_POSTS)
  .map(([path, raw]) => {
    const { meta, body } = parseFrontmatter(raw);
    const slug = slugFromPath(path);
    return {
      slug,
      title: String(meta.title ?? slug),
      description: String(meta.description ?? ""),
      date: String(meta.date ?? "1970-01-01"),
      author: meta.author ? String(meta.author) : undefined,
      tags: Array.isArray(meta.tags) ? (meta.tags as string[]) : [],
      body: body.trim(),
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
