import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadDelay: 50,
    // Reuse preloaded loader data on navigation to avoid the brief blank/
    // pending flash that caused a visible "shake" between sidebar pages.
    defaultPreloadStaleTime: 30_000,
    // Only show the pending UI if a transition takes noticeably long;
    // fast navigations render in place without flicker.
    defaultPendingMs: 500,
    defaultPendingMinMs: 0,
  });

  return router;
};
