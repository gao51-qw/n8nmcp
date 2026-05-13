import { describe, it, expect } from "vitest";
import { LOCALES, type Locale } from "@/i18n/config";
import { DOCS_DICTIONARIES, buildDocsRouteHead, type DocsDict } from "@/i18n/docs-dict";

type PageKey = Exclude<keyof DocsDict, "nav">;

const PAGES: Array<{
  pageKey: PageKey;
  navItemKey: keyof DocsDict["nav"]["items"];
  logicalPath: string;
}> = [
  { pageKey: "index",          navItemKey: "overview",        logicalPath: "/docs" },
  { pageKey: "gettingStarted", navItemKey: "gettingStarted",  logicalPath: "/docs/getting-started" },
  { pageKey: "concepts",       navItemKey: "concepts",        logicalPath: "/docs/concepts" },
  { pageKey: "clients",        navItemKey: "clients",         logicalPath: "/docs/clients" },
  { pageKey: "apiKeys",        navItemKey: "apiKeys",         logicalPath: "/docs/api-keys" },
  { pageKey: "n8nInstances",   navItemKey: "n8nInstances",    logicalPath: "/docs/n8n-instances" },
  { pageKey: "tools",          navItemKey: "tools",           logicalPath: "/docs/tools" },
  { pageKey: "quotas",         navItemKey: "quotas",          logicalPath: "/docs/quotas" },
  { pageKey: "security",       navItemKey: "security",        logicalPath: "/docs/security" },
];

function pickMeta(meta: Array<Record<string, unknown>>, sel: Record<string, string>) {
  return meta.find((m) =>
    Object.entries(sel).every(([k, v]) => (m as Record<string, unknown>)[k] === v),
  ) as Record<string, unknown> | undefined;
}

describe("docs route head() — i18n integrity", () => {
  for (const locale of LOCALES) {
    for (const page of PAGES) {
      it(`[${locale}] ${page.logicalPath} pulls title/description from dict`, () => {
        const dict = DOCS_DICTIONARIES[locale as Locale];
        const expected = dict[page.pageKey];
        const head = buildDocsRouteHead({
          rawLocale: locale,
          pageKey: page.pageKey,
          navItemKey: page.navItemKey,
          logicalPath: page.logicalPath,
        });

        expect(pickMeta(head.meta, { title: expected.title })).toBeTruthy();
        expect(pickMeta(head.meta, { name: "description", content: expected.description })).toBeTruthy();
        expect(pickMeta(head.meta, { property: "og:title", content: expected.title })).toBeTruthy();
        expect(pickMeta(head.meta, { property: "og:description", content: expected.description })).toBeTruthy();
        expect(pickMeta(head.meta, { name: "twitter:title", content: expected.title })).toBeTruthy();
        expect(pickMeta(head.meta, { name: "twitter:description", content: expected.description })).toBeTruthy();

        // og:url must be locale-prefixed (except English) and absolute.
        const ogUrl = pickMeta(head.meta, { property: "og:url" });
        expect(ogUrl).toBeTruthy();
        const url = String(ogUrl!.content);
        expect(url.startsWith("https://n8nmcp.lovable.app")).toBe(true);
        if (locale !== "en") expect(url).toContain(`/${locale}/`);

        // Exactly one canonical link, matching og:url.
        const canonicals = head.links.filter((l) => l.rel === "canonical");
        expect(canonicals).toHaveLength(1);
        expect(canonicals[0].href).toBe(url);
      });
    }
  }

  it("no two locales share the same title or description per page", () => {
    for (const page of PAGES) {
      const titles = new Set<string>();
      const descs = new Set<string>();
      for (const locale of LOCALES) {
        const p = DOCS_DICTIONARIES[locale as Locale][page.pageKey];
        expect(p.title, `${locale}/${page.pageKey} title missing`).toBeTruthy();
        expect(p.description, `${locale}/${page.pageKey} description missing`).toBeTruthy();
        titles.add(p.title);
        descs.add(p.description);
      }
      expect(titles.size, `duplicate title across locales for ${page.pageKey}`).toBe(LOCALES.length);
      expect(descs.size, `duplicate description across locales for ${page.pageKey}`).toBe(LOCALES.length);
    }
  });

  it("all locale dicts cover every docs page", () => {
    for (const locale of LOCALES) {
      const dict = DOCS_DICTIONARIES[locale as Locale];
      for (const page of PAGES) {
        expect(dict[page.pageKey], `${locale} missing ${page.pageKey}`).toBeTruthy();
        expect(dict.nav.items[page.navItemKey], `${locale} nav missing ${page.navItemKey}`).toBeTruthy();
      }
    }
  });
});