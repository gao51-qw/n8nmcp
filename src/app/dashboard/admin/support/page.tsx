"use client";

import { AdminAgentHeartbeat } from "@/components/support/admin-agent-heartbeat";
import { AdminTicketWorkbench } from "@/components/support/admin-ticket-workbench";

export default function AdminSupportPage() {
  return (
    <main id="main" className="mx-auto max-w-[96rem] px-4 py-10 sm:px-6 lg:py-14">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold text-primary">Administration</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Support workbench</h1>
          <p className="mt-3 max-w-3xl text-muted-foreground">
            Triage the live queue, protect response SLAs, and coordinate ticket ownership.
          </p>
        </div>
        <AdminAgentHeartbeat />
      </div>

      <div className="mt-8 overflow-hidden rounded-xl border bg-card shadow-sm">
        <AdminTicketWorkbench />
      </div>
    </main>
  );
}
