import type { Metadata } from "next";
import Script from "next/script";
import { Bricolage_Grotesque, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import { AuthProvider } from "@/components/auth-provider";
import { siteUrl } from "@/lib/site-domains";
import "@/styles.css";

const bricolage = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-bricolage",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const hanken = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-hanken",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

const mcpSiteUrl = siteUrl("mcp");

export const metadata: Metadata = {
  metadataBase: new URL(mcpSiteUrl),
  title: {
    default: "n8n-mcp - MCP Gateway for n8n Workflows",
    template: "%s | n8n-mcp",
  },
  description:
    "Hosted MCP gateway for n8n. Connect self-hosted n8n workflows to Claude, ChatGPT, Cursor and any MCP-compatible AI client.",
  alternates: {
    canonical: "/",
  },
  openGraph: {
    title: "n8n-mcp - MCP Gateway for n8n Workflows",
    description:
      "Connect n8n workflows to Claude, ChatGPT, Cursor and MCP-compatible AI clients in minutes.",
    url: "/",
    siteName: "n8n-mcp",
    type: "website",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "n8n-mcp connects n8n workflows to AI clients through MCP",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "n8n-mcp - MCP Gateway for n8n Workflows",
    description: "Hosted MCP gateway for n8n and MCP-compatible AI clients.",
    images: ["/opengraph-image"],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`dark ${bricolage.variable} ${hanken.variable} ${jetbrains.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen bg-background font-sans text-foreground antialiased">
        <a
          href="#main"
          className="sr-only focus-visible:not-sr-only focus-visible:fixed focus-visible:left-4 focus-visible:top-4 focus-visible:z-[100] focus-visible:inline-flex focus-visible:items-center focus-visible:gap-2 focus-visible:rounded-md focus-visible:bg-primary focus-visible:px-4 focus-visible:py-2 focus-visible:text-sm focus-visible:font-medium focus-visible:text-primary-foreground focus-visible:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Skip to main content
        </a>
        <AuthProvider>{children}</AuthProvider>
        <Script id="theme-before-paint" strategy="beforeInteractive">
          {`try{var t=localStorage.getItem('n8n-mcp-theme')||'dark';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.classList.toggle('dark',d);}catch(e){}`}
        </Script>
      </body>
    </html>
  );
}
