import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MessagesSquare, Plus, Send, Loader2, Trash2, User, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Markdown } from "@/components/markdown";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Chat Agent — n8n-mcp" }] }),
  component: ChatPage,
});

type Conversation = { id: string; title: string | null; updated_at: string };
type Message = { id: string; role: "user" | "assistant"; content: string; created_at: string };

function ChatPage() {
  const qc = useQueryClient();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const conversations = useQuery({
    queryKey: ["chat-conversations"],
    queryFn: async (): Promise<Conversation[]> => {
      const { data, error } = await supabase
        .from("chat_conversations")
        .select("id,title,updated_at")
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    // Mutations on this page invalidate ["chat-conversations"]; safe to
    // keep cached aggressively to remove sidebar flicker.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  // Auto-select first conversation
  useEffect(() => {
    if (!activeId && conversations.data?.length) setActiveId(conversations.data[0].id);
  }, [conversations.data, activeId]);

  const messages = useQuery({
    queryKey: ["chat-messages", activeId],
    enabled: !!activeId,
    queryFn: async (): Promise<Message[]> => {
      const { data, error } = await supabase
        .from("chat_messages")
        .select("id,role,content,created_at")
        .eq("conversation_id", activeId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Message[];
    },
    // Per-conversation message log; new messages invalidate this key.
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });

  const usage = useQuery({
    queryKey: ["prompt-usage-today"],
    refetchInterval: 30_000,
    queryFn: async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return { used: 0, tier: "free" as const };
      const today = new Date().toISOString().slice(0, 10);
      const [u, s] = await Promise.all([
        supabase.from("prompt_usage_daily").select("prompts").eq("user_id", user.id).eq("day", today).maybeSingle(),
        supabase.from("subscriptions").select("tier").eq("user_id", user.id).maybeSingle(),
      ]);
      return { used: u.data?.prompts ?? 0, tier: (s.data?.tier as string) ?? "free" };
    },
  });

  const limit = useMemo(() => {
    const t = usage.data?.tier ?? "free";
    return t === "enterprise" ? Infinity : t === "pro" ? 200 : 5;
  }, [usage.data]);

  const send = useMutation({
    mutationFn: async (text: string) => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not signed in");
      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/chat-agent`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ conversation_id: activeId, message: text }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error ?? `HTTP ${res.status}`);
      return json as { conversation_id: string; reply: string };
    },
    onSuccess: (r) => {
      if (!activeId) setActiveId(r.conversation_id);
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
      qc.invalidateQueries({ queryKey: ["chat-messages", r.conversation_id] });
      qc.invalidateQueries({ queryKey: ["prompt-usage-today"] });
      qc.invalidateQueries({ queryKey: ["quota"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onSend = () => {
    const t = draft.trim();
    if (!t || send.isPending) return;
    setDraft("");
    send.mutate(t);
  };

  const newChat = () => {
    setActiveId(null);
    setDraft("");
  };

  const deleteConversation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("chat_conversations").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, id) => {
      toast.success("Conversation deleted");
      if (activeId === id) setActiveId(null);
      qc.invalidateQueries({ queryKey: ["chat-conversations"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  // Auto-scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages.data, send.isPending]);

  const used = usage.data?.used ?? 0;
  const remaining = limit === Infinity ? "∞" : Math.max(0, limit - used);

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-3 md:flex-row">
      {/* Sidebar */}
      <aside className="flex w-full shrink-0 flex-col rounded-xl border border-border bg-card md:w-72">
        <div className="flex items-center justify-between gap-2 border-b border-border p-3">
          <div className="text-sm font-semibold">Conversations</div>
          <Button size="sm" variant="ghost" onClick={newChat} className="h-7 px-2">
            <Plus className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {conversations.isLoading ? (
            <div className="p-3 text-xs text-muted-foreground">Loading…</div>
          ) : !conversations.data?.length ? (
            <div className="p-3 text-xs text-muted-foreground">No conversations yet.</div>
          ) : (
            conversations.data.map((c) => (
              <div
                key={c.id}
                className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm ${
                  activeId === c.id ? "bg-accent" : "hover:bg-accent/50"
                }`}
              >
                <button
                  className="flex-1 truncate text-left"
                  onClick={() => setActiveId(c.id)}
                  title={c.title ?? "Untitled"}
                >
                  {c.title ?? "Untitled"}
                </button>
                <button
                  className="opacity-0 group-hover:opacity-100"
                  onClick={() => deleteConversation.mutate(c.id)}
                  aria-label="Delete"
                >
                  <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-destructive" />
                </button>
              </div>
            ))
          )}
        </div>
        <div className="border-t border-border p-3 text-xs text-muted-foreground">
          <div className="flex items-center justify-between">
            <span>Daily prompts</span>
            <Badge variant="secondary">
              {used} / {limit === Infinity ? "∞" : limit}
            </Badge>
          </div>
          <div className="mt-1">{remaining} remaining ({usage.data?.tier ?? "free"})</div>
        </div>
      </aside>

      {/* Main */}
      <main className="flex min-h-0 flex-1 flex-col rounded-xl border border-border bg-card">
        <header className="flex items-center gap-2 border-b border-border p-3">
          <MessagesSquare className="h-5 w-5 text-primary" />
          <div className="text-base font-semibold">Chat Agent</div>
          <span className="text-xs text-muted-foreground">— natural-language n8n workflow generator</span>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto p-4">
          {!activeId && !send.isPending && (
            <div className="grid h-full place-items-center text-center">
              <div>
                <Sparkles className="mx-auto h-10 w-10 text-primary" />
                <h2 className="mt-3 text-lg font-semibold">Describe an automation</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                  e.g. "When a Stripe invoice is paid, post the customer name and amount to Slack #sales."
                </p>
              </div>
            </div>
          )}
          {messages.data?.map((m) => (
            <MessageRow key={m.id} role={m.role} content={m.content} />
          ))}
          {send.isPending && (
            <MessageRow role="assistant" content="" pending />
          )}
        </div>

        <div className="border-t border-border p-3">
          <div className="flex items-end gap-2">
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Describe the workflow you want…"
              rows={2}
              className="resize-none"
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  onSend();
                }
              }}
              disabled={send.isPending}
            />
            <Button onClick={onSend} disabled={!draft.trim() || send.isPending}>
              {send.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">⌘/Ctrl + Enter to send</div>
        </div>
      </main>
    </div>
  );
}

function MessageRow({ role, content, pending }: { role: "user" | "assistant"; content: string; pending?: boolean }) {
  const isUser = role === "user";
  return (
    <div className={`flex gap-3 ${isUser ? "justify-end" : ""}`}>
      {!isUser && (
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/15 text-primary">
          <Sparkles className="h-4 w-4" />
        </div>
      )}
      <div
        className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${
          isUser ? "bg-primary text-primary-foreground" : "bg-muted/60"
        }`}
      >
        {pending ? (
          <span className="inline-flex items-center gap-2 text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Thinking…
          </span>
        ) : isUser ? (
          <div className="whitespace-pre-wrap">{content}</div>
        ) : (
          <Markdown>{content}</Markdown>
        )}
      </div>
      {isUser && (
        <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-foreground">
          <User className="h-4 w-4" />
        </div>
      )}
    </div>
  );
}
