import type { Metadata } from "next";
import { dashboardMetadata } from "@/components/dashboard/page-metadata";
import { UsageClient } from "./usage-client";

export const metadata: Metadata = dashboardMetadata(
  "Usage",
  "Today's MCP calls against your daily limit, and your recent calls.",
);

export default function UsagePage() {
  return <UsageClient />;
}
