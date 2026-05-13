# GEO / AI-SEO 优化计划

目标：让 ChatGPT / Claude / Perplexity / Google AI Overviews 等生成式搜索引擎能更准确、更频繁地引用 n8nmcp.lovable.app。

---

## 1. 新增 `/llms.txt` 与 `/llms-full.txt`（关键缺失）

新建两个 server 路由：

- `src/routes/llms[.]txt.tsx` — 简版站点摘要（项目定位、核心价值、主要章节链接），遵循 llmstxt.org 规范
- `src/routes/llms-full[.]txt.tsx` — 完整版，把 `/docs/*` 全部 11 个页面的标题 + 正文以 Markdown 形式聚合输出

技术细节：
- `llms-full.txt` 从 docs 路由对应的内容数据源生成（如已有 markdown 文件则直接读取；否则在文档页提取核心段落）
- 设置 `Content-Type: text/plain; charset=utf-8`，`Cache-Control: public, max-age=3600`

---

## 2. 扩展 `sitemap.xml`

修改 `src/routes/sitemap[.]xml.tsx` 的 `PAGES` 数组，补全：

- `/faq`
- `/docs/getting-started`、`/docs/concepts`、`/docs/clients`、`/docs/api-keys`、`/docs/n8n-instances`、`/docs/tools`、`/docs/quotas`、`/docs/security`（共 8 个文档页）
- `/imprint`（如希望被收录）

文档页设置 `priority: 0.7`，`changefreq: monthly`。

---

## 3. `robots.txt` 显式声明 AI 爬虫

修改 `src/routes/robots[.]txt.tsx`，在通用规则后追加：

```
User-agent: GPTBot
Allow: /

User-agent: ChatGPT-User
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: CCBot
Allow: /
```

每个 bot 同样 Disallow 私有路径（`/dashboard`、`/admin` 等）。

---

## 4. 清理 `__root.tsx` 重复 meta

`src/routes/__root.tsx` 的 `head().meta` 中：
- `description` 出现 2 次
- `og:description` 出现 2 次
- `og:image` / `twitter:image` 用的是 Lovable preview R2 的临时 URL

操作：
- 删除重复的 `description` / `og:description` 条目
- 暂时保留 og:image，但加 TODO 注释提示替换为正式品牌图（如有现成 logo 可立即替换为 favicon 或 logo 的绝对 URL）

---

## 5. Blog 文章添加 `BlogPosting` JSON-LD

修改 `src/routes/blog.$slug.tsx` 的 `head()`：

```ts
scripts: [{
  type: "application/ld+json",
  children: JSON.stringify({
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    description: post.excerpt,
    datePublished: post.date,
    dateModified: post.updatedAt ?? post.date,
    author: { "@type": "Person", name: post.author ?? "n8n-mcp" },
    mainEntityOfPage: `https://n8nmcp.lovable.app/blog/${post.slug}`,
    publisher: { "@type": "Organization", name: "n8n-mcp",
      logo: { "@type": "ImageObject", url: "https://n8nmcp.lovable.app/favicon.ico" }}
  })
}]
```

同时补 `BreadcrumbList`：Home → Blog → Post。

---

## 6. Docs 页面添加 `TechArticle` + `BreadcrumbList`

为 `src/components/docs/docs-layout.tsx` 引入一个共享 helper `buildDocsJsonLd(title, description, slug)`，输出：

- `@type: TechArticle` — headline、description、author=Organization、inLanguage="en"
- `@type: BreadcrumbList` — Home → Docs → 当前页

每个 `src/routes/docs.*.tsx` 在 `head().scripts` 中调用一次。

文档首页 `docs.index.tsx` 额外加 `@type: ItemList`，列出全部 docs 页面，提升 AI 对结构的理解。

---

## 7. 首页补 `BreadcrumbList` + `WebSite` SearchAction

`src/routes/index.tsx` `head().scripts` 追加：

- `WebSite` schema with `potentialAction: SearchAction` (即使没站内搜索，声明为空也可被部分引擎识别为根入口)
- 不需要 BreadcrumbList（首页是根）

---

## 技术细节小结

- 全部新增路由用 TanStack Start 的 `createFileRoute` + `server.handlers.GET`，不引入新依赖
- llms-full.txt 体积需控制在 < 200KB；如 docs 内容超量，按页分段并在 llms.txt 中列子链接
- 所有 JSON-LD 注入使用 head() `scripts` 字段，避免 hydration 警告
- 修改不触及任何后端逻辑、数据库或 RLS

---

## 实施顺序

1. 修复 `__root.tsx` 重复 meta（5 分钟）
2. 扩展 sitemap.xml + robots.txt AI bot 规则
3. 新增 llms.txt / llms-full.txt
4. Blog + Docs 结构化数据
5. 首页 WebSite schema

完成后用 curl 验证生产站点：
- `/llms.txt`、`/llms-full.txt` 返回 200
- `/sitemap.xml` 包含全部新 URL
- `/robots.txt` 列出 AI bot
- 首页 / blog / docs 页 JSON-LD 数量正确