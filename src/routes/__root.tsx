import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect } from "react";

import appCss from "../styles.css?url";
import { AuthProvider } from "@/hooks/use-auth";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeToggle } from "@/components/theme-toggle";
import { applyTheme, getStoredTheme } from "@/lib/theme";
import { NavPerfOverlay } from "@/components/nav-perf-overlay";
import { getPublicSiteSettings } from "@/lib/site-settings.functions";

function NotFoundComponent() {
  return (
    <main id="main" tabIndex={-1} className="relative flex min-h-screen items-center justify-center bg-background px-4 outline-none">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </main>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <main id="main" tabIndex={-1} className="relative flex min-h-screen items-center justify-center bg-background px-4 outline-none">
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">{error.message}</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium"
          >
            Go home
          </a>
        </div>
      </div>
    </main>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Load site-wide integration settings (GA4 / GSC) so we can inject the
  // tracking script + verification meta tag into <head> during SSR. The
  // root loader only runs once per navigation and we cache aggressively so
  // this doesn't become a per-page round-trip.
  loader: async () => {
    try {
      const siteSettings = await getPublicSiteSettings();
      return { siteSettings };
    } catch {
      return {
        siteSettings: { ga4MeasurementId: null, gscVerification: null } as const,
      };
    }
  },
  staleTime: 5 * 60_000,
  head: ({ loaderData }) => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "n8n-mcp — Connect n8n workflows to AI via MCP" },
      {
        name: "description",
        content:
          "Hosted MCP gateway for n8n. Expose your workflows to Claude, ChatGPT and any MCP-compatible client in seconds.",
      },
      { property: "og:title", content: "n8n-mcp — Connect n8n workflows to AI via MCP" },
      {
        property: "og:description",
        content: "Hosted MCP gateway for n8n. Plug your workflows into AI clients.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: "n8n-mcp — Connect n8n workflows to AI via MCP" },
      { name: "twitter:description", content: "N8N-MCP is an application that helps users manage and compare n8n nodes and build a blog." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2fe62c52-3f83-4199-b5d9-615ed7ed10df/id-preview-fcaba1f0--647c0212-1ada-432a-820b-9bc428006c49.lovable.app-1778483476360.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2fe62c52-3f83-4199-b5d9-615ed7ed10df/id-preview-fcaba1f0--647c0212-1ada-432a-820b-9bc428006c49.lovable.app-1778483476360.png" },
      { name: "description", content: "N8N-MCP is an application that helps users manage and compare n8n nodes and build a blog." },
      { property: "og:description", content: "N8N-MCP is an application that helps users manage and compare n8n nodes and build a blog." },
      ...(loaderData?.siteSettings?.gscVerification
        ? [{ name: "google-site-verification", content: loaderData.siteSettings.gscVerification }]
        : []),
    ],
    links: [{ rel: "stylesheet", href: appCss }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Organization",
          name: "n8n-mcp",
          url: "https://n8nmcp.lovable.app",
          logo: "https://n8nmcp.lovable.app/favicon.ico",
          sameAs: ["https://github.com/czlonkowski/n8n-mcp"],
        }),
      },
      ...(loaderData?.siteSettings?.ga4MeasurementId
        ? [
            {
              src: `https://www.googletagmanager.com/gtag/js?id=${loaderData.siteSettings.ga4MeasurementId}`,
              async: true,
            },
            {
              children: `window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${loaderData.siteSettings.ga4MeasurementId}');`,
            },
          ]
        : []),
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <head>
        <HeadContent />
        <script
          // Apply persisted theme before paint to avoid FOUC
          dangerouslySetInnerHTML={{
            __html: `try{var t=localStorage.getItem('n8n-mcp-theme')||'dark';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-screen bg-background text-foreground antialiased">
        {/* Skip-to-content link: visually hidden until it receives keyboard
            focus, then animates into view at the top-left. Lives at the very
            top of <body> so it's the first Tab stop on every page. */}
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:inline-flex focus-visible:items-center focus-visible:gap-2 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-primary-foreground focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Skip to main content
        </a>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // Re-apply the persisted theme on every route change. The FOUC script and
  // ThemeToggle already keep things in sync, but a navigation can occasionally
  // leave the .dark class out of sync (e.g. after auth-driven redirects or
  // when external code mutates document.documentElement). This is a cheap
  // idempotent guard that prevents brief visual mismatches.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  useEffect(() => {
    applyTheme(getStoredTheme());
  }, [pathname]);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <main id="main" tabIndex={-1} className="outline-none">
            {/*
              No keyed wrapper / entrance animation here.
              Previously this div had key={pathname} + animate-in +
              slide-in-from-bottom, which forced a remount and a 300ms
              translate-Y on EVERY sidebar click. That is exactly the
              "页面弹出/抖动" the user reported. Page transitions should
              feel instant; any per-route animation belongs inside the
              individual route component, not at the router boundary.
            */}
            <Outlet />
          </main>
          <Toaster richColors position="top-right" />
          <NavPerfOverlay />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
