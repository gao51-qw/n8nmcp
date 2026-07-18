import type { Metadata } from "next";

import { AgentConsoleClient } from "./agent-console-client";

export const metadata: Metadata = {
  title: "Workflow Agent Console",
  description: "Workflow agent operations console backed by MCP call and audit data.",
  robots: { index: false, follow: false },
};

export default function AgentConsolePage() {
  return <AgentConsoleClient />;
}
