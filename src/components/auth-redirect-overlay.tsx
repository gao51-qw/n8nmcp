import { Sparkles } from "lucide-react";

type Props = {
  /** Which provider the overlay is announcing. null hides the overlay. */
  provider: "google" | "apple" | null;
};

const LABEL: Record<NonNullable<Props["provider"]>, string> = {
  google: "Redirecting to Google",
  apple: "Redirecting to Apple",
};

/**
 * Full-screen overlay shown after an OAuth button is clicked, while the
 * browser is preparing the cross-origin redirect. Fades in on top of the
 * current page so the user never sees a hard cut to white.
 *
 * Uses `fixed inset-0` + a high z-index so it sits over every route,
 * `pointer-events-auto` to swallow stray clicks during the redirect, and
 * `motion-safe` animations so reduced-motion users get an instant overlay
 * instead of a missing transition.
 */
export function AuthRedirectOverlay({ provider }: Props) {
  if (!provider) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label={LABEL[provider]}
      className="fixed inset-0 z-[200] flex items-center justify-center bg-background/95 backdrop-blur-sm motion-safe:animate-in motion-safe:fade-in motion-safe:duration-200"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 left-1/2 h-[480px] w-[480px] -translate-x-1/2 rounded-full opacity-30 blur-3xl"
        style={{ background: "var(--gradient-primary)" }}
      />
      <div className="relative flex flex-col items-center gap-4 motion-safe:animate-in motion-safe:fade-in motion-safe:zoom-in-95 motion-safe:duration-300">
        <span
          className="grid h-12 w-12 place-items-center rounded-xl shadow-lg motion-safe:animate-pulse"
          style={{ background: "var(--gradient-primary)" }}
        >
          <Sparkles className="h-6 w-6 text-primary-foreground" />
        </span>
        <div className="flex items-center gap-3 text-sm text-foreground">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
          <span>{LABEL[provider]}…</span>
        </div>
        <p className="max-w-xs text-center text-xs text-muted-foreground">
          Hold tight while we hand you off securely.
        </p>
      </div>
    </div>
  );
}
