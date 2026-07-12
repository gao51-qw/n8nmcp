"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import {
  WorkflowAgentConsole,
  type WorkflowAgentConsoleData,
} from "@/components/workflow-agent/agent-console";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { subscribeToWorkflowAgentConsole } from "@/lib/workflow-agent/realtime.client";
import type { DashboardAgentAction } from "@/lib/workflow-agent/dashboard-actions.server";
import type { WorkflowAgentActionState } from "@/components/workflow-agent/agent-console";

type LoadState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: WorkflowAgentConsoleData; error: null }
  | { status: "error"; data: null; error: string };

export function AgentConsoleClient() {
  const [state, setState] = useState<LoadState>({ status: "loading", data: null, error: null });
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [session, setSession] = useState<{ token: string; userId: string } | null>(null);
  const [actionState, setActionState] = useState<WorkflowAgentActionState>({ status: "idle" });
  const [confirmation, setConfirmation] = useState<{
    token: string;
    summary: string;
    input: DashboardAgentAction;
  } | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let active = true;
    void supabase.auth.getSession().then(({ data, error }) => {
      const authSession = data.session;
      if (!active) return;
      if (error || !authSession?.access_token || !authSession.user.id) {
        setState({ status: "error", data: null, error: "Authentication required" });
        return;
      }
      setSession({ token: authSession.access_token, userId: authSession.user.id });
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => setRefreshIndex((value) => value + 1), 150);
    };
    const unsubscribe = subscribeToWorkflowAgentConsole(session.userId, {
      onInvalidate: scheduleRefresh,
      onStatus: () => undefined,
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const activeSession = session;
    const controller = new AbortController();

    async function load() {
      setState((current) =>
        current.status === "ready" ? current : { status: "loading", data: null, error: null },
      );
      try {
        const response = await fetch("/api/dashboard/agent-console", {
          headers: { authorization: `Bearer ${activeSession.token}` },
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            (await response.text()) || `Agent console request failed (${response.status})`,
          );
        }

        const payload = (await response.json()) as { data: WorkflowAgentConsoleData };
        if (!controller.signal.aborted) {
          setState({ status: "ready", data: payload.data, error: null });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            data: null,
            error: error instanceof Error ? error.message : "Agent console request failed",
          });
        }
      }
    }

    void load();
    return () => {
      controller.abort();
    };
  }, [refreshIndex, session]);

  async function runAction(input: DashboardAgentAction): Promise<void> {
    if (!session) throw new Error("Authentication required");
    setActionState({ status: "pending", message: "Applying the trusted workflow action..." });
    try {
      const response = await fetch("/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: {
          authorization: `Bearer ${session.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      });
      const payload = (await response.json()) as {
        error?: { message?: string };
        confirmation?: { token: string; summary?: string };
      };
      if (response.status === 409 && payload.confirmation?.token) {
        setConfirmation({
          token: payload.confirmation.token,
          summary: payload.confirmation.summary ?? "Confirm this workflow action.",
          input,
        });
        setActionState({ status: "confirming", message: "Confirmation required." });
        return;
      }
      if (!response.ok)
        throw new Error(payload.error?.message ?? `Workflow action failed (${response.status})`);
      setActionState({ status: "success", message: "Workflow action completed." });
      setRefreshIndex((value) => value + 1);
    } catch (error) {
      setActionState({
        status: "error",
        message: error instanceof Error ? error.message : "Workflow action failed",
      });
      throw error;
    }
  }

  async function confirmAction() {
    if (!confirmation) return;
    const { input, token } = confirmation;
    setConfirmation(null);
    await runAction({ ...input, confirmationToken: token });
  }

  if (state.status === "ready") {
    return (
      <>
        <WorkflowAgentConsole
          data={state.data}
          actionState={actionState}
          onApply={(input) => runAction({ action: "apply", ...input })}
          onRollback={(input) => runAction({ action: "rollback", ...input })}
        />
        <AlertDialog open={confirmation !== null}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Confirm workflow action</AlertDialogTitle>
              <AlertDialogDescription>{confirmation?.summary}</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel
                onClick={() => {
                  setConfirmation(null);
                  setActionState({ status: "idle" });
                }}
              >
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction onClick={() => void confirmAction()}>Confirm</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </>
    );
  }

  return (
    <main className="mx-auto flex min-h-[50vh] max-w-4xl items-center justify-center px-6 py-16">
      <div className="w-full rounded-lg border border-border bg-card p-6 shadow-sm">
        {state.status === "loading" ? (
          <div className="flex items-center gap-3 text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
            Loading workflow agent data...
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <h1 className="text-xl font-semibold">Workflow Agent Console</h1>
              <p className="mt-2 text-sm text-muted-foreground">{state.error}</p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setRefreshIndex((value) => value + 1)}
            >
              <RefreshCw className="h-4 w-4" aria-hidden="true" />
              Retry
            </Button>
          </div>
        )}
      </div>
    </main>
  );
}
