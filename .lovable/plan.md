## 目标

把多语言从 Cookie 切换迁移到 URL 路径 `/{-$locale}/...`（英文保持无前缀，其他语言用 `/zh/...`、`/ja/...`、`/es/...`、`/de/...`），并补齐 SEO 元数据（hreflang、canonical、多语 sitemap），让 Google 能正确抓取每种语言版本。

---

## 路由结构改造

把 `src/routes/` 下所有"内容页"挪到可选 locale 段下：

```
src/routes/
  {-$locale}/
    index.tsx                    -> /  和  /zh  /ja  /es  /de
    pricing.tsx
    faq.tsx
    docs.tsx                     (layout)
    docs.index.tsx
    docs.getting-started.tsx
    docs.concepts.tsx
    docs.clients.tsx
    docs.api-keys.tsx
    docs.n8n-instances.tsx
    docs.tools.tsx
    docs.quotas.tsx
    docs.security.tsx
    blog.index.tsx
    blog.$slug.tsx
    terms.tsx
    privacy.tsx
    imprint.tsx
```

不迁移（保持原路径，不参与 i18n）：
- `login.tsx` / `signup.tsx` / `_authenticated/*` / `admin-setup.tsx` —— 应用内功能
- `api/*`、`sitemap.xml`、`robots.txt`、`llms.txt`、`llms-full.txt` —— 系统资源

---

## i18n 运行时改造

`src/i18n/context.tsx`：
- 移除 cookie 读写 + 浏览器嗅探作为 source of truth
- `LocaleProvider` 改为接收 `locale` prop（来自 URL params），cookie 仅作为"用户偏好"用于根路径自动重定向
- `useLocale()` 从 router params 派生

`src/routes/{-$locale}/__root` 不存在 —— 仍用 `src/routes/__root.tsx`，但在其 `component` 里读取 `useParams({ strict: false }).locale`，传入 `LocaleProvider`。

`language-switcher.tsx`：用 `useNavigate` + 当前 pathname，把 locale 段替换为目标语言，写入 cookie（仅作偏好记忆）。

非法 locale（例如 `/fr/...`）通过根路由 `beforeLoad` 校验，未命中时 `throw notFound()`。

---

## SEO 元数据

每个迁移后的路由 `head()`：
- `title` / `description` 从字典取
- `<link rel="canonical">` 指向当前语言版本绝对 URL
- 5 条 `<link rel="alternate" hreflang="...">` + 1 条 `hreflang="x-default"` 指向英文版

抽出 helper `buildLocaleHead({ path, locale, t })` 复用。

---

## sitemap.xml

`src/routes/sitemap[.]xml.tsx` 改为：
- 每个内容页输出 5 条 `<url>`（每语言一条）
- 每条 `<url>` 内嵌 `<xhtml:link rel="alternate" hreflang="...">` 列出所有语言对应版本 + `x-default`
- 命名空间加 `xmlns:xhtml="http://www.w3.org/1999/xhtml"`

---

## 验证

1. 构建通过（typecheck + Vite SSR）
2. `curl` 抓取 `/`、`/zh`、`/ja/pricing`、`/de/docs/security` 检查：
   - HTTP 200
   - `<html lang="...">` 正确
   - `<title>` / `<meta description>` 是对应语言
   - canonical + 5 条 hreflang 都存在
3. `curl /sitemap.xml` 检查每个 URL 都带 `xhtml:link` alternate 块
4. 浏览器切语言 → URL 跟着变；刷新后语言不丢

---

## 技术细节

- 路径参数用 `{-$locale}` (TanStack 可选段)，根路由在 `beforeLoad` 内校验在 `LOCALES` 内或为 `undefined`（=英文）
- 站点 base URL 常量集中在 `src/lib/seo.ts` 新增 `LOCALE_HREFLANG_MAP`、`buildLocalizedUrl(path, locale)`、`buildAlternates(path)`
- `Link` 调用：站内导航全部加 `params={(prev) => ({ ...prev, locale: prev.locale })}` 保持当前语言；语言切换器显式覆盖 `locale`
- 英文 URL 保持不带前缀（`locale === undefined`），符合 SEO 最佳实践
- `__root.tsx` 在 `<html>` 上设置 `lang={locale ?? "en"}`

---

## 工作量预估

约 25–30 个文件改动（含路由文件移动 + Link 调用更新 + 新 helper + sitemap 重写）。完成后再回头补 docs 字典装配（上一轮未收尾的部分）。
