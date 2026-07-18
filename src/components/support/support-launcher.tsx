"use client";

import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LifeBuoy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supportFetch } from "@/lib/support/http.client";
import { SupportChatPanel } from "./support-chat-panel";

export function SupportLauncher({
  user,
  sentryEventId,
  mcpRequestId,
}: {
  user: Pick<User, "id"> | null;
  sentryEventId?: string;
  mcpRequestId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [online, setOnline] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    void supportFetch<{ online: boolean; count: number }>("/api/support/availability")
      .then((availability) => {
        if (active) setOnline(availability.online);
      })
      .catch(() => {
        if (active) setOnline(false);
      });
    return () => {
      active = false;
    };
  }, [user]);

  if (!user) return null;

  return (
    <>
      {!open ? (
        <Button
          type="button"
          size="lg"
          className="fixed bottom-5 right-5 z-40 rounded-full shadow-lg"
          aria-label="Open support chat"
          onClick={() => setOpen(true)}
        >
          <LifeBuoy className="h-5 w-5" aria-hidden="true" />
          <span className="hidden sm:inline">Support</span>
        </Button>
      ) : null}
      <SupportChatPanel
        open={open}
        onOpenChange={setOpen}
        userId={user.id}
        online={online}
        sentryEventId={sentryEventId}
        mcpRequestId={mcpRequestId}
      />
    </>
  );
}
