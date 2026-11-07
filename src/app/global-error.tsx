"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect, type MouseEvent } from "react";

// Next.js prerenders this page (/_global-error) without the per-request CSP
// nonce (src/proxy.ts, src/lib/csp.ts). Served under the enforced policy its
// scripts are blocked and the page never hydrates, so recovery must work as
// plain HTML: "Try again" is a link to the current URL (an empty href reloads
// the page) and the home link always works. When JavaScript does run, the
// error is reported to Sentry and "Try again" first tries reset(), which
// re-renders without a full reload.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  function tryAgain(event: MouseEvent<HTMLAnchorElement>) {
    // Let modified clicks (new tab, new window) use the link as usual.
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      return;
    }
    try {
      reset();
      event.preventDefault();
    } catch {
      // reset() failed: the link reloads the page instead.
    }
  }

  return (
    <html lang="en">
      <body>
        <main>
          <h1>Something went wrong</h1>
          <p>The error has been recorded. Please try again.</p>
          <p>
            <a href="" onClick={tryAgain}>
              Try again
            </a>{" "}
            or <a href="/">go to the home page</a>.
          </p>
        </main>
      </body>
    </html>
  );
}
