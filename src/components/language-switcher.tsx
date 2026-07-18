"use client";

import * as React from "react";
import { Check, Globe } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LOCALES, LOCALE_LABELS, type Locale } from "@/i18n/config";
import { useLocale } from "@/i18n/context";
import { localizedPath, stripLocalePrefix } from "@/lib/seo-i18n";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => setMounted(true), []);

  const switchTo = (target: Locale) => {
    setLocale(target);
    const logical = stripLocalePrefix(pathname);
    const query = searchParams.toString();
    router.push(`${localizedPath(logical, target)}${query ? `?${query}` : ""}`);
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size={compact ? "icon" : "sm"}
          aria-label={t.nav.language}
          className={compact ? "" : "gap-2"}
        >
          <Globe className="h-4 w-4" />
          {!compact && (
            <span className="text-xs" suppressHydrationWarning>
              {mounted ? LOCALE_LABELS[locale] : LOCALE_LABELS.en}
            </span>
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[10rem]">
        <DropdownMenuLabel>{t.nav.language}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {LOCALES.map((l) => (
          <DropdownMenuItem
            key={l}
            onClick={() => switchTo(l)}
            className="flex items-center justify-between gap-3"
          >
            <span>{LOCALE_LABELS[l]}</span>
            {l === locale ? <Check className="h-4 w-4 opacity-70" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
