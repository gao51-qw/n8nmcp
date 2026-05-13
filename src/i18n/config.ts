// Supported UI languages. English is the default and shown when no locale
// cookie is set or the cookie has been cleared. Adding a new locale only
// requires extending this array and dropping a matching dictionary file.
export const LOCALES = ["en", "zh", "ja", "es", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  zh: "中文",
  ja: "日本語",
  es: "Español",
  de: "Deutsch",
};

export const LOCALE_COOKIE = "nmcp_locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}