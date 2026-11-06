import type { Metadata } from "next";
import { Suspense, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { canonicalUrl } from "@/lib/site-domains";

/** Metadata shared by the account pages: a real title, never indexed. */
export function authPageMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: canonicalUrl(path, "dashboard") },
    robots: { index: false, follow: false },
  };
}

export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main
      id="main"
      className="flex min-h-[calc(100vh-4rem)] items-center justify-center px-6 py-16"
    >
      <section className="w-full max-w-md rounded-xl border border-border bg-card p-8 shadow-sm">
        <div className="space-y-2">
          <p className="text-sm font-medium text-primary">n8n-mcp</p>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <div className="mt-8">{children}</div>
        {footer ? (
          <div className="mt-6 space-y-2 text-center text-sm text-muted-foreground">{footer}</div>
        ) : null}
      </section>
    </main>
  );
}

/** `useSearchParams()` in the client forms needs a Suspense boundary. */
export function AuthSuspense({ children }: { children: ReactNode }) {
  return (
    <Suspense
      fallback={
        <main id="main" className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-label="Loading" />
        </main>
      }
    >
      {children}
    </Suspense>
  );
}
