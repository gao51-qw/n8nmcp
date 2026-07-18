import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

export type BlogPost = {
  slug: string;
  title: string;
  description: string;
  date: string;
  updated?: string;
  author: string;
  tags: string[];
  body: string;
};

const blogDir = join(process.cwd(), "src", "content", "blog");

function parseFrontmatter(raw: string): Omit<BlogPost, "slug"> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  const frontmatter = match?.[1] ?? "";
  const body = match?.[2] ?? raw;
  const data = new Map<string, string>();

  for (const line of frontmatter.split(/\r?\n/)) {
    const [key, ...rest] = line.split(":");
    if (!key || rest.length === 0) continue;
    data.set(key.trim(), rest.join(":").trim().replace(/^"|"$/g, ""));
  }

  const tagsRaw = data.get("tags") ?? "[]";
  const tags = [...tagsRaw.matchAll(/"([^"]+)"/g)].map((tag) => tag[1]);

  return {
    title: data.get("title") ?? "Untitled post",
    description: data.get("description") ?? "",
    date: data.get("date") ?? new Date(0).toISOString(),
    updated: data.get("updated"),
    author: data.get("author") ?? "n8n-mcp team",
    tags,
    body: body.trim(),
  };
}

export function getBlogPosts(): BlogPost[] {
  return readdirSync(blogDir)
    .filter((file) => file.endsWith(".mdx"))
    .map((file) => {
      const slug = file.replace(/\.mdx$/, "");
      const raw = readFileSync(join(blogDir, file), "utf8");
      return { slug, ...parseFrontmatter(raw) };
    })
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
}

export function getBlogPost(slug: string): BlogPost | null {
  return getBlogPosts().find((post) => post.slug === slug) ?? null;
}
