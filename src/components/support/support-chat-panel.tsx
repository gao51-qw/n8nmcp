"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Loader2, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { supportFetch } from "@/lib/support/http.client";
import { subscribeToTicket } from "@/lib/support/realtime.client";
import type { SupportTicket, TicketAttachment } from "@/lib/support/types";
import { AttachmentPicker, validateSupportFiles } from "./attachment-picker";
import { TicketConversation, type SupportReply } from "./ticket-conversation";

type SupportPanelState =
  | { kind: "closed" }
  | { kind: "checking" }
  | { kind: "new"; online: boolean }
  | { kind: "conversation"; ticketId: string }
  | { kind: "error"; message: string };

type TicketResponse = { ticket: SupportTicket; replies?: SupportReply[] };

type SupportChatPanelProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  userId: string;
  online: boolean;
  sentryEventId?: string;
  mcpRequestId?: string;
};

function storageKey(userId: string) {
  return `n8n-mcp:support-ticket:${userId}`;
}

function sanitizeFilename(name: string) {
  const sanitized = name
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "")
    .slice(0, 120);
  return sanitized || "attachment";
}

async function uploadAttachments(userId: string, ticketId: string, files: File[]) {
  const expiresAt = new Date();
  expiresAt.setUTCDate(expiresAt.getUTCDate() + 180);

  return Promise.all(
    files.map(async (file): Promise<TicketAttachment> => {
      const path = `${userId}/${ticketId}/${crypto.randomUUID()}-${sanitizeFilename(file.name)}`;
      const { error } = await supabase.storage
        .from("ticket-attachments")
        .upload(path, file, { contentType: file.type || undefined, upsert: false });
      if (error) throw new Error(error.message || "Unable to upload attachment");
      return {
        path,
        name: file.name,
        size: file.size,
        ...(file.type ? { type: file.type } : {}),
        expiresAt: expiresAt.toISOString(),
      };
    }),
  );
}

async function removeUploadedAttachments(paths: readonly string[]) {
  if (paths.length === 0) return;
  try {
    await supabase.storage.from("ticket-attachments").remove([...paths]);
  } catch {
    // Best effort only; server-side retention cleanup remains the fallback.
  }
}

export function SupportChatPanel({
  open,
  onOpenChange,
  userId,
  online,
  sentryEventId,
  mcpRequestId,
}: SupportChatPanelProps) {
  const [state, setState] = useState<SupportPanelState>({ kind: "closed" });
  const [ticket, setTicket] = useState<SupportTicket | null>(null);
  const [replies, setReplies] = useState<SupportReply[]>([]);
  const [body, setBody] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const lastSeenAt = useRef(new Date().toISOString());

  const loadTicket = useCallback(
    async (ticketId: string) => {
      const result = await supportFetch<TicketResponse>(`/api/support/tickets/${ticketId}`);
      if (result.ticket.status === "resolved" || result.ticket.status === "closed") {
        localStorage.removeItem(storageKey(userId));
        setTicket(null);
        setReplies([]);
        setState({ kind: "new", online });
        return;
      }
      setTicket(result.ticket);
      setReplies(result.replies ?? []);
      lastSeenAt.current = result.ticket.lastReplyAt || new Date().toISOString();
      setState({ kind: "conversation", ticketId });
    },
    [online, userId],
  );

  useEffect(() => {
    if (!open) {
      setState({ kind: "closed" });
      return;
    }

    const ticketId = localStorage.getItem(storageKey(userId));
    if (!ticketId) {
      setState({ kind: "new", online });
      return;
    }

    setState({ kind: "checking" });
    void loadTicket(ticketId).catch(() => {
      localStorage.removeItem(storageKey(userId));
      setTicket(null);
      setReplies([]);
      setState({ kind: "new", online });
    });
  }, [loadTicket, online, open, userId]);

  const conversationTicketId = state.kind === "conversation" ? state.ticketId : null;

  useEffect(() => {
    if (!open || !conversationTicketId) return;
    return subscribeToTicket(conversationTicketId, {
      onReply: () => void loadTicket(conversationTicketId),
      onTicket: () => void loadTicket(conversationTicketId),
      getLastSeenAt: () => lastSeenAt.current,
      onReconnect: () => void loadTicket(conversationTicketId),
    });
  }, [loadTicket, open, conversationTicketId]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const message = body.trim();
    if (!message || sending) return;
    const fileError = validateSupportFiles(files);
    if (fileError) {
      setState({ kind: "error", message: fileError });
      return;
    }

    setSending(true);
    let uploadedPaths: string[] = [];
    let apiAccepted = false;
    try {
      if (!ticket) {
        const ticketId = crypto.randomUUID();
        const attachments = await uploadAttachments(userId, ticketId, files);
        uploadedPaths = attachments.map((attachment) => attachment.path);
        const result = await supportFetch<{ ticket: SupportTicket }>("/api/support/tickets", {
          method: "POST",
          body: JSON.stringify({
            ticketId,
            title: message.length > 80 ? `${message.slice(0, 77)}...` : message,
            description: message,
            category: "other",
            priority: "normal",
            source: "live_chat",
            attachments,
            ...(sentryEventId ? { sentryEventId } : {}),
            ...(mcpRequestId ? { mcpRequestId } : {}),
          }),
        });
        apiAccepted = true;
        localStorage.setItem(storageKey(userId), result.ticket.id);
        setTicket(result.ticket);
        setReplies([]);
        setState({ kind: "conversation", ticketId: result.ticket.id });
      } else {
        const attachments = await uploadAttachments(userId, ticket.id, files);
        uploadedPaths = attachments.map((attachment) => attachment.path);
        await supportFetch(`/api/support/tickets/${ticket.id}/replies`, {
          method: "POST",
          body: JSON.stringify({ body: message, attachments }),
        });
        apiAccepted = true;
        await loadTicket(ticket.id);
      }
      setBody("");
      setFiles([]);
    } catch (error) {
      if (!apiAccepted) {
        await removeUploadedAttachments(uploadedPaths);
      }
      setState({
        kind: "error",
        message: error instanceof Error ? error.message : "Unable to send your message.",
      });
    } finally {
      setSending(false);
    }
  }

  if (!open) return null;

  return (
    <section
      className="fixed inset-x-3 bottom-3 z-50 flex max-h-[calc(100dvh-1.5rem)] flex-col overflow-hidden rounded-2xl border bg-background shadow-2xl sm:inset-x-auto sm:bottom-6 sm:right-6 sm:w-[25rem]"
      role="dialog"
      aria-modal="false"
      aria-labelledby="support-chat-title"
    >
      <header className="flex items-center justify-between border-b bg-muted/30 px-4 py-3">
        <div>
          <h2 id="support-chat-title" className="text-sm font-semibold">
            Support
          </h2>
          <p className="text-xs text-muted-foreground">
            {online ? "Support agents are available" : "Your message will become a support ticket"}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Close support chat"
          onClick={() => onOpenChange(false)}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </header>

      {state.kind === "checking" ? (
        <div className="flex min-h-48 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
          Loading your conversation...
        </div>
      ) : ticket ? (
        <TicketConversation ticket={ticket} replies={replies} />
      ) : (
        <div className="space-y-2 px-4 py-5">
          <p className="text-sm font-medium">How can we help?</p>
          <p className="text-sm text-muted-foreground">
            Share the outcome you expected and what happened instead. We will keep this thread
            connected to your account.
          </p>
        </div>
      )}

      <form className="space-y-3 border-t p-3" onSubmit={handleSubmit}>
        {state.kind === "error" ? (
          <p className="text-xs text-destructive" role="alert">
            {state.message}
          </p>
        ) : null}
        <label className="sr-only" htmlFor="support-message">
          Message
        </label>
        <Textarea
          id="support-message"
          value={body}
          disabled={sending}
          placeholder={ticket ? "Reply to support..." : "Describe what you need help with..."}
          className="min-h-20 resize-none"
          onChange={(event) => setBody(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
        />
        <div className="flex items-end justify-between gap-3">
          <AttachmentPicker files={files} onChange={setFiles} disabled={sending} />
          <Button type="submit" size="sm" disabled={sending || !body.trim()}>
            {sending ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : (
              <Send className="h-4 w-4" aria-hidden="true" />
            )}
            Send
          </Button>
        </div>
      </form>
    </section>
  );
}
