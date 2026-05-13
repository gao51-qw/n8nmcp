// SEO helpers for the multi-locale URL scheme.
//
// English is the default and lives at the un-prefixed path (e.g. /pricing).
// Other locales sit under /{locale}/... (e.g. /zh/pricing). These helpers
// build canonical URLs and the full set of <link rel="alternate" hreflang>
// entries each shareable route should ship in <head>.

import { LOCALES, DEFAULT_LOCALE, type Locale } from "@/i18n/config";

export const SITE_ORIGIN = "https://n8nmcp.lovable.app";

// Map our internal locale codes to the BCP-47 / hreflang values Google expects.
export const LOCALE_HREFLANG: Record<Locale, string> = {
  en: "en",
  zh: "zh-Hans",
  ja: "ja",
  es: "es",
  de: "de",
};

/** Strip leading/trailing slashes and any locale prefix, returning the
 *  "logical path" (always without leading slash). */
export function stripLocalePrefix(pathname: string): string {
  const clean = pathname.replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) return "";
  const [first, ...rest] = clean.split("/");
  if ((LOCALES as readonly string[]).includes(first)) {
    return rest.join("/");
  }
  return clean;
}

/** Build a path for a given locale. English → "/path", others → "/zh/path". */
export function localizedPath(logicalPath: string, locale: Locale): string {
  const clean = logicalPath.replace(/^\/+/, "").replace(/\/+$/, "");
  if (locale === DEFAULT_LOCALE) return clean ? `/${clean}` : "/";
  return clean ? `/${locale}/${clean}` : `/${locale}`;
}

/** Absolute URL for a logical path in a given locale. */
export function localizedUrl(logicalPath: string, locale: Locale): string {
  return `${SITE_ORIGIN}${localizedPath(logicalPath, locale)}`;
}

/** Build the canonical + hreflang `<link>` set for a logical path. */
export function buildAlternateLinks(logicalPath: string, currentLocale: Locale) {
  const links: Array<{ rel: string; href: string; hrefLang?: string }> = [
    { rel: "canonical", href: localizedUrl(logicalPath, currentLocale) },
  ];
  for (const l of LOCALES) {
    links.push({
      rel: "alternate",
      hrefLang: LOCALE_HREFLANG[l],
      href: localizedUrl(logicalPath, l),
    });
  }
  links.push({
    rel: "alternate",
    hrefLang: "x-default",
    href: localizedUrl(logicalPath, DEFAULT_LOCALE),
  });
  return links;
}

/** OpenGraph locale tag (e.g. "zh_CN"). */
export const OG_LOCALE: Record<Locale, string> = {
  en: "en_US",
  zh: "zh_CN",
  ja: "ja_JP",
  es: "es_ES",
  de: "de_DE",
};