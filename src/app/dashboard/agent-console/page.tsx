import type { Metadata } from "next";

import { dashboardMetadata } from "@/components/dashboard/page-metadata";
import { AgentConsoleClient } from "./agent-console-client";

export const metadata: Metadata = dashboardMetadata(
  "Agent Console",
  "Review workflow changes proposed by your AI agent, then apply or roll them back.",
);

export default function AgentConsolePage() {
  return <AgentConsoleClient />;
}
