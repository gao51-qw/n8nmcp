"use client";

import * as React from "react";
import NextLink, { type LinkProps as NextLinkProps } from "next/link";

type LocalizedLinkProps = Omit<React.AnchorHTMLAttributes<HTMLAnchorElement>, "href"> &
  Omit<NextLinkProps, "href" | "as"> & {
    to?: string;
    href?: string;
    hash?: string;
  };

function hrefFromParts(to: string | undefined, hash: string | undefined) {
  const base = to || "/";
  if (!hash) return base;
  return `${base}${hash.startsWith("#") ? hash : `#${hash}`}`;
}

export const Link = React.forwardRef<HTMLAnchorElement, LocalizedLinkProps>(function Link(
  { to, href, hash, ...props },
  ref,
) {
  return <NextLink ref={ref} href={href ?? hrefFromParts(to, hash)} {...props} />;
});
