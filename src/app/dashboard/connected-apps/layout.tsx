import type { Metadata } from "next";
import type { ReactNode } from "react";
import { dashboardMetadata } from "@/components/dashboard/page-metadata";

// The page itself is a client component, so its title is declared here.
export const metadata: Metadata = dashboardMetadata(
  "Connected apps",
  "Apps you connected to n8n-mcp through OAuth.",
);

export default function ConnectedAppsLayout({ children }: { children: ReactNode }) {
  return children;
}
