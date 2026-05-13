import * as React from "react";
import { DICTIONARIES, type Dict } from "./dict";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  isLocale,
  type Locale,
} from "./config";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: Dict;
};

const LocaleContext = React.createContext<Ctx | null>(null);

function readCookieLocale(): Locale {
  if (typeof document === "undefined") return DEFAULT_LOCALE;
  const m = document.cookie.match(
    new RegExp("(?:^|; )" + LOCALE_COOKIE + "=([^;]*)"),
  );
  const raw = m?.[1] ? decodeURIComponent(m[1]) : null;
  return isLocale(raw) ? raw : DEFAULT_LOCALE;
}

function detectBrowserLocale(): Locale | null {
  if (typeof navigator === "undefined") return null;
  const langs = navigator.languages?.length
    ? navigator.languages
    : [navigator.language];
  for (const lang of langs) {
    const short = lang.toLowerCase().split("-")[0];
    if (isLocale(short)) return short;
  }
  return null;
}

export function LocaleProvider({ children }: { children: React.ReactNode }) {
  // Always start with the SSR default to keep server- and client-rendered
  // markup identical. After mount we promote to the cookie / browser pick.
  const [locale, setLocaleState] = React.useState<Locale>(DEFAULT_LOCALE);

  React.useEffect(() => {
    const cookieLocale = readCookieLocale();
    if (cookieLocale !== DEFAULT_LOCALE) {
      setLocaleState(cookieLocale);
      return;
    }
    const browser = detectBrowserLocale();
    if (browser && browser !== DEFAULT_LOCALE) setLocaleState(browser);
  }, []);

  const setLocale = React.useCallback((l: Locale) => {
    setLocaleState(l);
    if (typeof document !== "undefined") {
      const oneYear = 60 * 60 * 24 * 365;
      document.cookie = `${LOCALE_COOKIE}=${encodeURIComponent(l)}; max-age=${oneYear}; path=/; samesite=lax`;
    }
  }, []);

  const value = React.useMemo<Ctx>(
    () => ({ locale, setLocale, t: DICTIONARIES[locale] }),
    [locale, setLocale],
  );

  return (
    <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
  );
}

export function useLocale(): Ctx {
  const ctx = React.useContext(LocaleContext);
  if (!ctx) {
    return {
      locale: DEFAULT_LOCALE,
      setLocale: () => {},
      t: DICTIONARIES[DEFAULT_LOCALE],
    };
  }
  return ctx;
}

export function useT(): Dict {
  return useLocale().t;
}