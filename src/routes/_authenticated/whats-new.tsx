import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type Announcement = { id: string; title: string; body: string; published_at: string };

export const Route = createFileRoute("/_authenticated/whats-new")({
  head: () => ({ meta: [{ title: "What's New — n8n-mcp" }] }),
  component: WhatsNew,
});

function WhatsNew() {
  const [items, setItems] = useState<Announcement[]>([]);
  useEffect(() => {
    supabase
      .from("announcements")
      .select("*")
      .order("published_at", { ascending: false })
      .then(({ data }) => setItems(data ?? []));
  }, []);

  return (
    <div className="max-w-2xl">
      <h1 className="text-3xl font-bold">What's new</h1>
      <div className="mt-6 space-y-4">
        {items.length === 0 && (
          <div className="rounded-xl border border-border bg-card p-6 text-sm text-muted-foreground">
            No announcements yet.
          </div>
        )}
        {items.map((a) => (
          <div key={a.id} className="rounded-xl border border-border bg-card p-6">
            <div className="text-xs text-muted-foreground">{new Date(a.published_at).toLocaleDateString()}</div>
            <h2 className="mt-1 text-lg font-semibold">{a.title}</h2>
            <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">{a.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
