import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        // Reuse fetched data across navigations instead of refetching on every
        // remount. 60s is short enough that user-driven mutations stay visible
        // (mutations explicitly invalidate their queries) but long enough to
        // make sidebar navigation feel instant.
        staleTime: 60_000,
        // Keep inactive query data in memory for 30 minutes so quick
        // back-and-forth between pages reuses cached results without any
        // network round-trip.
        gcTime: 30 * 60_000,
        // Don't blank the UI when the tab regains focus — the previous
        // refetch storm was a major source of perceived flicker.
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        // Avoid the brief "no data yet" flash on remount; React Query will
        // serve cached data immediately and revalidate silently in the
        // background when stale.
        refetchOnMount: false,
        retry: 1,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    // Cache reuse for router loaders. The router's SWR cache is keyed by
    // route path + loaderDeps, so a longer staleTime + preloadStaleTime means
    // re-entering a page from the sidebar serves cached data instantly with
    // no pending UI. Background revalidation still keeps it fresh.
    defaultStaleTime: 60_000,
    defaultPreloadStaleTime: 5 * 60_000,
    defaultGcTime: 30 * 60_000,
    // Only show the pending UI if a transition takes noticeably long;
    // fast navigations render in place without flicker.
    defaultPendingMs: 500,
    defaultPendingMinMs: 0,
  });

  return router;
};
