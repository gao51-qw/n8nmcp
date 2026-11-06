import type { Metadata } from "next";
import type { ReactNode } from "react";
import { dashboardMetadata } from "@/components/dashboard/page-metadata";

// The page itself is a client component, so its title is declared here.
export const metadata: Metadata = dashboardMetadata(
  "Account",
  "Your account details and account deletion.",
);

export default function AccountLayout({ children }: { children: ReactNode }) {
  return children;
}
