import type { Metadata } from "next";
import type { ReactNode } from "react";
import { dashboardMetadata } from "@/components/dashboard/page-metadata";

// The page itself is a client component, so its title is declared here.
export const metadata: Metadata = dashboardMetadata(
  "API keys",
  "Create and revoke API keys for your MCP clients.",
);

export default function ApiKeysLayout({ children }: { children: ReactNode }) {
  return children;
}
