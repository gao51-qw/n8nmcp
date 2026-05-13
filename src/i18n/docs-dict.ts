import { useLocale } from "./context";
import en from "./locales/docs/en";
import zh from "./locales/docs/zh";
import ja from "./locales/docs/ja";
import es from "./locales/docs/es";
import de from "./locales/docs/de";
import type { Locale } from "./config";

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