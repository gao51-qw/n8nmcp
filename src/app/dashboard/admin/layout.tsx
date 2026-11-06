import type { Metadata } from "next";
import type { ReactNode } from "react";
import { dashboardMetadata } from "@/components/dashboard/page-metadata";
import { AdminGate } from "./admin-gate";

// A server layout so admin routes get a title; the role check runs in the
// client-side AdminGate.
export const metadata: Metadata = dashboardMetadata(
  "Admin",
  "Administration tools for the n8n-mcp team.",
);

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminGate>{children}</AdminGate>;
}
