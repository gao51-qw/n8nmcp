import { useLocale } from "./context";
import en from "./locales/docs/en";
import zh from "./locales/docs/zh";
import ja from "./locales/docs/ja";
import es from "./locales/docs/es";
import de from "./locales/docs/de";
import type { Locale } from "./config";
import { LOCALES } from "./config";
import {
  OG_LOCALE,
  buildAlternateLinks,
  localizedUrl,
  resolveLocale,
} from "@/lib/seo-i18n";
import {
  buildBreadcrumbJsonLd,
  buildDocsTechArticleJsonLd,
} from "@/lib/seo-jsonld";

/** Per-route docs page metadata keys (must have title/description/h1). */
type DocsPageKey =
  | "index"
  | "gettingStarted"
  | "concepts"
  | "clients"
  | "apiKeys"
  | "n8nInstances"
  | "tools"
  | "quotas"
  | "security";

const HREFLANG_INLANGUAGE: Record<Locale, string> = {
  en: "en",
  zh: "zh-Hans",
  ja: "ja",
  es: "es",
  de: "de",
};

/**
 * One-stop head() builder for a docs route. Resolves the locale from the
 * URL param, pulls title/description/breadcrumb-name from the matching docs
 * dict, and emits unique meta + canonical/hreflang links + JSON-LD per
 * locale so each language is a distinct, non-duplicated page.
 */
export function buildDocsRouteHead(args: {
  rawLocale: unknown;
  pageKey: DocsPageKey;
  /** Key into `nav.items` used for the breadcrumb leaf name. */
  navItemKey: keyof DocsDict["nav"]["items"];
  /** Logical path (no locale prefix), e.g. "/docs/clients" or "/docs". */
  logicalPath: string;
}) {
  const locale = resolveLocale(args.rawLocale);
  const t = DOCS_DICTIONARIES[locale] ?? en;
  const page = t[args.pageKey];
  const { title, description } = page;
  const url = localizedUrl(args.logicalPath, locale);
  const docsRoot = t.nav.items.overview;
  const isIndex = args.logicalPath.replace(/\/+$/, "") === "/docs";
  const breadcrumb = isIndex
    ? [{ name: "Home", path: "/" }, { name: docsRoot, path: "/docs" }]
    : [
        { name: "Home", path: "/" },
        { name: docsRoot, path: "/docs" },
        { name: t.nav.items[args.navItemKey], path: args.logicalPath },
      ];

  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:type", content: isIndex ? "website" : "article" },
      { property: "og:locale", content: OG_LOCALE[locale] },
      ...LOCALES.filter((l) => l !== locale).map((l) => ({
        property: "og:locale:alternate",
        content: OG_LOCALE[l],
      })),
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: buildAlternateLinks(args.logicalPath, locale),
    scripts: [
      {
        type: "application/ld+json",
        children: buildDocsTechArticleJsonLd({
          title,
          description,
          path: args.logicalPath,
          inLanguage: HREFLANG_INLANGUAGE[locale],
        }),
      },
      {
        type: "application/ld+json",
        children: buildBreadcrumbJsonLd(breadcrumb),
      },
    ],
  };
}

export type DocsDict = typeof en;

export const DOCS_DICTIONARIES: Record<Locale, DocsDict> = {
  en,
  zh,
  ja,
  es,
  de,
};

export function useDocsT(): DocsDict {
  const { locale } = useLocale();
  return DOCS_DICTIONARIES[locale] ?? en;
}

/**
 * Build a locale-aware docs head() payload — title/description/OG come from
 * the matching docs translation dict so each language ships unique metadata
 * (no English fallback bleed-through, no duplicate content across locales).
 */
export function buildDocsHead(args: {
  rawLocale: unknown;
  logicalPath: string; // e.g. "/docs/clients"
  pick: (t: DocsDict) => { title: string; description: string };
  ogType?: string;
  scripts?: Array<{ type: string; children: string }>;
}) {
  const locale = resolveLocale(args.rawLocale);
  const t = DOCS_DICTIONARIES[locale] ?? en;
  const { title, description } = args.pick(t);
  const url = localizedUrl(args.logicalPath, locale);
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:url", content: url },
      { property: "og:type", content: args.ogType ?? "article" },
      { property: "og:locale", content: OG_LOCALE[locale] },
      ...LOCALES.filter((l) => l !== locale).map((l) => ({
        property: "og:locale:alternate",
        content: OG_LOCALE[l],
      })),
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
    ],
    links: buildAlternateLinks(args.logicalPath, locale),
    ...(args.scripts ? { scripts: args.scripts } : {}),
  };
}