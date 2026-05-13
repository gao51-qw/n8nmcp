import en from "./locales/en";
import zh from "./locales/zh";
import ja from "./locales/ja";
import es from "./locales/es";
import de from "./locales/de";
import type { Locale } from "./config";

// English is the source of truth — all other locales must match its shape.
export type Dict = typeof en;

export const DICTIONARIES: Record<Locale, Dict> = {
  en,
  zh,
  ja,
  es,
  de,
};