# 多语言（i18n）实施方案

## 范围
- **语言**：英文（默认）、简体中文、日本語、Español、Deutsch
- **页面**：首页 / Pricing / FAQ / Blog 列表+详情 / 8 个 Docs 子页 / Terms / Privacy / Imprint
- **不包含**：Dashboard、Settings、Billing、Connect、Admin、Auth 页（保持英文）

## URL 结构（SEO 友好）
英文走根路径，其它语言加前缀：
```
/                          → English (默认)
/pricing                   → English
/docs/getting-started      → English
/zh                        → 中文首页
/zh/pricing                → 中文 Pricing
/ja/docs/getting-started   → 日文文档
/es/blog                   → 西文博客
/de/faq                    → 德文 FAQ
```
比 `?lang=` 或纯 cookie 方案的 SEO 收益高一个量级——每种语言都是独立可索引页面。

## 技术实现

### 1. 路由重构（一次性）
把营销+文档路由整体迁移到 `{-$locale}` 可选参数下：
```
src/routes/
  {-$locale}/
    index.tsx                    ← 原 index.tsx
    pricing.tsx
    faq.tsx
    blog.index.tsx
    blog.$slug.tsx
    docs.tsx (layout)
    docs.index.tsx
    docs.getting-started.tsx
    docs.concepts.tsx
    docs.clients.tsx
    docs.api-keys.tsx
    docs.n8n-instances.tsx
    docs.tools.tsx
    docs.quotas.tsx
    docs.security.tsx
    terms.tsx
    privacy.tsx
    imprint.tsx
```
未受影响：`_authenticated/*`、`api/public/*`、`login`、`signup`、`admin-setup`、`llms.txt`、`robots.txt`、`sitemap.xml`、`__root.tsx`。

### 2. 翻译字典
```
src/i18n/
  config.ts            ← LOCALES = ['en','zh','ja','es','de']，类型与默认值
  context.tsx          ← LocaleProvider + useT() hook（轻量，无外部库）
  locales/
    en.ts  zh.ts  ja.ts  es.ts  de.ts
```
字典按页面分组（`home.hero.title`、`pricing.cta`、`docs.gettingStarted.intro`…），TypeScript 全程类型安全，缺 key 直接编译报错。

**初始翻译用 Lovable AI（Gemini 2.5 Pro）批量生成**，免费且质量高；之后你可以手工润色。

### 3. 组件改造
- 在 `LocaleProvider` 中根据路由 `params.locale ?? 'en'` 注入语言。
- `useT()` 返回当前语言字典。
- 营销 Header 加语言切换下拉（🌐 EN / 中文 / 日本語 / Español / Deutsch），切换时调用 `navigate({ to: currentRoute, params: { locale: newLocale === 'en' ? undefined : newLocale } })`。
- 持久化偏好到 cookie，首次访问根路径时按 `Accept-Language` 头跳转到匹配语言。

### 4. SEO 信号（关键）
- **hreflang**：在 `__root.tsx` 的 `head()` 里给每条路由生成 5 个 `<link rel="alternate" hreflang="...">` + 1 个 `x-default`。
- **canonical**：每页指向自己的 locale 版本。
- **`og:locale`**：随当前语言切换。
- **sitemap.xml**：URL 数从 19 增至 19 × 5 = 95（含 hreflang `<xhtml:link>` 兄弟标签）。
- **llms.txt**：在索引中加入 `## Translations` 章节，列出 5 种语言入口。
- **robots.txt**：无需改动。

### 5. 内容总量
约 15 个页面 × 5 种语言。Lovable AI 一次批量生成只需几次调用，token 成本可忽略。

## 实施顺序
1. 搭 i18n 基础设施（config / context / 空字典）
2. 迁移路由文件到 `{-$locale}/` 下，验证英文路径不变
3. 抽取所有硬编码英文字符串到 `en.ts` 字典
4. AI 批量翻译生成 `zh.ts` / `ja.ts` / `es.ts` / `de.ts`
5. 加语言切换 UI + cookie 持久化 + Accept-Language 重定向
6. 更新 sitemap / hreflang / llms.txt
7. 验证 5 种语言 + Search Console 抓取

## 注意事项
- 迁移路由是大动作，会触发 `routeTree.gen.ts` 重新生成；过程中 `<Link to="/pricing">` 等需改为 `<Link to="/{-$locale}/pricing" params={{ locale }}>`，全站搜索替换。
- Blog MDX 内容暂不翻译（5 种语言写 5 份 MDX 不现实），保持英文 + 在文章顶部加一行 "This post is available in English only"。如果你之后想多语博客，再单独规划。
- 文档量较大（每个 docs 页 ~200 行 JSX），AI 翻译后建议你或母语审校至少校对一遍。

## 预计交付
完成后你将拥有：5 种语言可索引 URL、自动语言切换器、完整 SEO 多语种信号、可随时编辑的本地化字典。
