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

/**
 * Locale is now driven by the URL `{-$locale}` path param. The provider
 * receives the resolved locale from the root route component and exposes it
 * via context. The cookie is kept as a soft preference (e.g. for landing on
 * an un-prefixed URL after the user has previously chosen Japanese), but it
 * never overrides the URL.
 */
export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const setLocale = React.useCallback((l: Locale) => {
    // The actual navigation is performed by the LanguageSwitcher; here we
    // just remember the user's choice so we can default to it on
    // un-prefixed visits.
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

/** Read the persisted locale preference from the cookie (browser only). */
export function readLocaleCookie(): Locale | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(
    new RegExp("(?:^|; )" + LOCALE_COOKIE + "=([^;]*)"),
  );
  const raw = m?.[1] ? decodeURIComponent(m[1]) : null;
  return isLocale(raw) ? raw : null;
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