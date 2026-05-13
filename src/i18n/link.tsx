// `Link` wrapper that automatically preserves the current `{-$locale}` path
// param. Routes that have been migrated under `src/routes/{-$locale}/` need
// every internal navigation to keep the user inside their chosen language;
// hand-threading `params={{ locale }}` on hundreds of <Link> calls is
// untenable, so we centralise it here.
//
// Authenticated / app-internal routes (login, signup, dashboard, etc.) live
// outside the `{-$locale}` segment, so passing an unused `locale` param to
// them is harmless (TanStack ignores params not declared by the target
// route).
//
// We intentionally type `to` and `params` loosely: TanStack's strict typing
// would force every call site to spell out `/{-$locale}/...`, defeating the
// point of the wrapper.

import * as React from "react";
import {
  Link as TLink,
  useParams,
  type LinkComponentProps,
} from "@tanstack/react-router";
import { isLocale, type Locale } from "./config";

type AnyLinkProps = Omit<LinkComponentProps<"a">, "to" | "params"> & {
  to?: any;
  params?: any;
};

export const Link = React.forwardRef<HTMLAnchorElement, AnyLinkProps>(
  function LocalizedLink(props, ref) {
    const params = useParams({ strict: false }) as { locale?: string };
    const currentLocale: Locale | undefined = isLocale(params.locale)
      ? params.locale
      : undefined;

    const userParams = (props as any).params;
    let mergedParams: any;
    if (typeof userParams === "function") {
      mergedParams = (prev: any) => {
        const out = userParams(prev) ?? {};
        if (out.locale === undefined) out.locale = currentLocale;
        return out;
      };
    } else if (userParams && typeof userParams === "object") {
      mergedParams =
        userParams.locale === undefined
          ? { ...userParams, locale: currentLocale }
          : userParams;
    } else {
      mergedParams = currentLocale ? { locale: currentLocale } : undefined;
    }

    return <TLink ref={ref} {...(props as any)} params={mergedParams} />;
  },
) as unknown as typeof TLink;