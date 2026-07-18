"use client";

import { Bot, UserRound } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { SupportTicket, TicketAttachment } from "@/lib/support/types";
import { cn } from "@/lib/utils";
import { SlaCountdown } from "./sla-countdown";

export type SupportReply = {
  id?: string;
  body?: string;
  is_admin?: boolean;
  isAdmin?: boolean;
  created_at?: string;
  createdAt?: string;
  attachments?: TicketAttachment[];
};

export function TicketConversation({
  ticket,
  replies,
}: {
  ticket: SupportTicket;
  replies: SupportReply[];
}) {
  const messages: SupportReply[] = [
    {
      id: `ticket-${ticket.id}`,
      body: ticket.description,
      isAdmin: false,
      createdAt: ticket.createdAt,
      attachments: ticket.attachments,
    },
    ...replies,
  ];

  return (
    <div className="min-h-0 flex-1">
      <div className="flex items-center justify-between gap-3 border-b px-4 py-2">
        <p className="text-sm font-medium">Ticket #{ticket.id.slice(0, 8).toUpperCase()}</p>
        {!ticket.firstRespondedAt ? <SlaCountdown dueAt={ticket.firstResponseDueAt} /> : null}
      </div>
      <ScrollArea className="h-[min(50vh,24rem)] px-4">
        <ol className="space-y-4 py-4" aria-label="Support conversation">
          {messages.map((message, index) => {
            const fromAgent = message.is_admin ?? message.isAdmin ?? false;
            return (
              <li
                key={message.id ?? `${index}-${message.created_at ?? message.createdAt ?? ""}`}
                className={cn("flex gap-2", fromAgent ? "justify-start" : "justify-end")}
              >
                {fromAgent ? (
                  <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                    <Bot className="h-4 w-4" aria-hidden="true" />
                  </span>
                ) : null}
                <div
                  className={cn(
                    "max-w-[82%] rounded-2xl px-3 py-2 text-sm shadow-sm",
                    fromAgent
                      ? "rounded-tl-sm border bg-card"
                      : "rounded-tr-sm bg-primary text-primary-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{message.body}</p>
                  {message.attachments?.length ? (
                    <p className="mt-1 text-xs opacity-75">
                      {message.attachments.length} attachment
                      {message.attachments.length === 1 ? "" : "s"}
                    </p>
                  ) : null}
                </div>
                {!fromAgent ? (
                  <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
                    <UserRound className="h-4 w-4" aria-hidden="true" />
                  </span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </ScrollArea>
    </div>
  );
}
