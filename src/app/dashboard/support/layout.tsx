import type { Metadata } from "next";
import type { ReactNode } from "react";
import { dashboardMetadata } from "@/components/dashboard/page-metadata";

// The page itself is a client component, so its title is declared here.
export const metadata: Metadata = dashboardMetadata(
  "Support",
  "Open support tickets and follow the conversation with the n8n-mcp team.",
);

export default function SupportLayout({ children }: { children: ReactNode }) {
  return children;
}
