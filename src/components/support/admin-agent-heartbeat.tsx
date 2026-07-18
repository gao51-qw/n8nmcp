"use client";

import { useCallback, useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { supportFetch } from "@/lib/support/http.client";

type HeartbeatResponse = {
  assignedCount?: number;
};

export function AdminAgentHeartbeat({ onHeartbeat }: { onHeartbeat?: () => void }) {
  const [online, setOnline] = useState(true);

  const heartbeat = useCallback(async () => {
    if (document.visibilityState !== "visible") return;

    try {
      await supportFetch<HeartbeatResponse>("/api/support/admin/heartbeat", {
        method: "POST",
      });
      setOnline(true);
      onHeartbeat?.();
    } catch {
      setOnline(false);
    }
  }, [onHeartbeat]);

  useEffect(() => {
    void heartbeat();

    const timer = window.setInterval(() => {
      void heartbeat();
    }, 30_000);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void heartbeat();
    };
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [heartbeat]);

  return (
    <span
      className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"
      role="status"
      aria-live="polite"
    >
      {online ? (
        <Wifi className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
      ) : (
        <WifiOff className="h-3.5 w-3.5 text-destructive" aria-hidden="true" />
      )}
      {online ? "Agent online" : "Heartbeat unavailable"}
    </span>
  );
}
