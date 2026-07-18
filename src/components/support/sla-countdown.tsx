"use client";

import { useEffect, useMemo, useState } from "react";
import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";

export function SlaCountdown({ dueAt }: { dueAt: string | null }) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!dueAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [dueAt]);

  const remaining = useMemo(() => (dueAt ? new Date(dueAt).getTime() - now : null), [dueAt, now]);
  if (remaining === null) return null;

  const breached = remaining <= 0;
  const dueSoon = remaining > 0 && remaining <= 30 * 60_000;
  const state = breached ? "breached" : dueSoon ? "due-soon" : "pending";
  const totalMinutes = Math.max(0, Math.ceil(Math.abs(remaining) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const value = hours ? `${hours}h ${minutes}m` : `${minutes}m`;
  const spokenValue = hours
    ? `${hours} ${hours === 1 ? "hour" : "hours"} ${minutes} ${
        minutes === 1 ? "minute" : "minutes"
      }`
    : `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const label = breached
    ? `First response SLA breached by ${spokenValue}`
    : dueSoon
      ? `First response due soon, ${spokenValue} remaining`
      : `First response target, ${spokenValue} remaining`;

  return (
    <span
      data-sla-state={state}
      className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium",
        breached
          ? "bg-destructive/10 text-destructive"
          : dueSoon
            ? "border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-950/30 dark:text-amber-200"
            : "text-muted-foreground",
      )}
      aria-live="polite"
      aria-label={label}
    >
      <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
      {breached
        ? `Response overdue by ${value}`
        : dueSoon
          ? `Response due soon ${value}`
          : `Response target ${value}`}
    </span>
  );
}
