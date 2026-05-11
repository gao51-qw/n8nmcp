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
import { installServerFnAuth } from "@/lib/server-fn-auth.client";

function NotFoundComponent() {
  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
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
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-background px-4">
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
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
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
      { name: "description", content: "N8N-MCP connects n8n official and community nodes, enabling AI to learn workflow creation." },
      { property: "og:description", content: "N8N-MCP connects n8n official and community nodes, enabling AI to learn workflow creation." },
      { name: "twitter:description", content: "N8N-MCP connects n8n official and community nodes, enabling AI to learn workflow creation." },
      { property: "og:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2fe62c52-3f83-4199-b5d9-615ed7ed10df/id-preview-fcaba1f0--647c0212-1ada-432a-820b-9bc428006c49.lovable.app-1778483476360.png" },
      { name: "twitter:image", content: "https://pub-bb2e103a32db4e198524a2e9ed8f35b4.r2.dev/2fe62c52-3f83-4199-b5d9-615ed7ed10df/id-preview-fcaba1f0--647c0212-1ada-432a-820b-9bc428006c49.lovable.app-1778483476360.png" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
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

  // Install fetch interceptor that attaches Supabase token to /_serverFn/* calls
  useEffect(() => {
    installServerFnAuth();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider>
          <Outlet />
          <Toaster richColors position="top-right" />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}
