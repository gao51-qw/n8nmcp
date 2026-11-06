import type { Metadata } from "next";
import type { ReactNode } from "react";
import { dashboardMetadata } from "@/components/dashboard/page-metadata";

// The page itself is a client component, so its title is declared here.
export const metadata: Metadata = dashboardMetadata(
  "Support workbench",
  "Triage the support queue and coordinate ticket ownership.",
);

export default function AdminSupportLayout({ children }: { children: ReactNode }) {
  return children;
}
