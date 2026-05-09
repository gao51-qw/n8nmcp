import { createFileRoute } from "@tanstack/react-router";
import { MessagesSquare, Sparkles } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated/chat")({
  head: () => ({ meta: [{ title: "Chat Agent — n8n-mcp" }] }),
  component: ChatStub,
});

function ChatStub() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-3xl font-bold tracking-tight">
          <MessagesSquare className="h-7 w-7 text-primary" /> Chat Agent
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conversational AI that writes n8n workflows for you.
        </p>
      </div>

      <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-primary" />
        <h2 className="mt-4 text-lg font-semibold">Coming online shortly</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
          The streaming agent is being wired up — once enabled it will accept natural-language
          prompts, generate n8n workflow JSON, and push it to a connected instance.
        </p>
        <div className="mt-5 flex justify-center gap-2">
          <Button asChild variant="outline">
            <Link to="/instances">Connect an n8n instance</Link>
          </Button>
          <Button asChild>
            <Link to="/billing">See Pro features</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
