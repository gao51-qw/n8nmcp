"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, LogIn, RefreshCw } from "lucide-react";

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
import { useAuth } from "@/components/auth-provider";
import { errorText } from "@/components/dashboard/error-text";
import { apiErrorFromResponse } from "@/lib/support/http.client";
import { subscribeToWorkflowAgentConsole } from "@/lib/workflow-agent/realtime.client";
import type { DashboardAgentAction } from "@/lib/workflow-agent/dashboard-actions.server";
import type { WorkflowAgentActionState } from "@/components/workflow-agent/agent-console";
import { SessionExpiredError, sessionFetch } from "./session-fetch";

type LoadState =
  | { status: "loading"; data: null; error: null }
  | { status: "ready"; data: WorkflowAgentConsoleData; error: null }
  | { status: "error"; data: null; error: string; expired: boolean };

type ConfirmationChallenge = { token: string; summary?: string };

/** The 409 `confirmation` challenge in an action error body, if there is one. */
function confirmationFrom(body: unknown): ConfirmationChallenge | null {
  if (!body || typeof body !== "object") return null;
  const challenge = (body as { confirmation?: unknown }).confirmation;
  if (!challenge || typeof challenge !== "object") return null;
  const { token, summary } = challenge as { token?: unknown; summary?: unknown };
  if (typeof token !== "string" || !token) return null;
  return { token, summary: typeof summary === "string" ? summary : undefined };
}

export function AgentConsoleClient() {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  const [state, setState] = useState<LoadState>({ status: "loading", data: null, error: null });
  const [refreshIndex, setRefreshIndex] = useState(0);
  const [actionState, setActionState] = useState<WorkflowAgentActionState>({ status: "idle" });
  const [confirmation, setConfirmation] = useState<{
    token: string;
    summary: string;
    input: DashboardAgentAction;
  } | null>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Realtime invalidation is keyed by the user id only, so a token refresh
  // never tears down and re-creates the channel.
  useEffect(() => {
    if (!userId) return;
    const scheduleRefresh = () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
      refreshTimer.current = setTimeout(() => setRefreshIndex((value) => value + 1), 150);
    };
    const unsubscribe = subscribeToWorkflowAgentConsole(userId, {
      onInvalidate: scheduleRefresh,
      onStatus: () => undefined,
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current) clearTimeout(refreshTimer.current);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;
    const controller = new AbortController();

    async function load() {
      setState((current) =>
        current.status === "ready" ? current : { status: "loading", data: null, error: null },
      );
      try {
        const response = await sessionFetch("/api/dashboard/agent-console", {
          signal: controller.signal,
        });
        if (!response.ok) throw await apiErrorFromResponse(response);

        const payload = (await response.json()) as { data: WorkflowAgentConsoleData };
        if (!controller.signal.aborted) {
          setState({ status: "ready", data: payload.data, error: null });
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          setState({
            status: "error",
            data: null,
            error: errorText(error, "The agent console could not be loaded."),
            expired: error instanceof SessionExpiredError,
          });
        }
      }
    }

    void load();
    return () => {
      controller.abort();
    };
  }, [refreshIndex, userId]);

  async function runAction(input: DashboardAgentAction): Promise<void> {
    setActionState({ status: "pending", message: "Applying the trusted workflow action..." });
    try {
      const response = await sessionFetch("/api/dashboard/agent-console/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      if (!response.ok) {
        const error = await apiErrorFromResponse(response);
        const challenge = response.status === 409 ? confirmationFrom(error.body) : null;
        if (challenge) {
          setConfirmation({
            token: challenge.token,
            summary: challenge.summary ?? "Confirm this workflow action.",
            input,
          });
          setActionState({ status: "confirming", message: "Confirmation required." });
          return;
        }
        throw error;
      }
      setActionState({ status: "success", message: "Workflow action completed." });
      setRefreshIndex((value) => value + 1);
    } catch (error) {
      setActionState({
        status: "error",
        message: errorText(error, "Workflow action failed"),
      });
      throw error;
    }
  }

  async function confirmAction() {
    if (!confirmation) return;
    const { input, token } = confirmation;
    setConfirmation(null);
    // A failure is already shown through actionState.
    await runAction({ ...input, confirmationToken: token }).catch(() => undefined);
  }

  function signInAgain() {
    const next = `${window.location.pathname}${window.location.search}`;
    window.location.assign(`/login?next=${encodeURIComponent(next)}`);
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
    <main
      id="main"
      className="mx-auto flex min-h-[50vh] max-w-4xl items-center justify-center px-6 py-16"
    >
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
              <p role="alert" className="mt-2 text-sm text-muted-foreground">
                {state.error}
              </p>
            </div>
            {state.expired ? (
              <Button type="button" onClick={signInAgain}>
                <LogIn className="h-4 w-4" aria-hidden="true" />
                Sign in again
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => setRefreshIndex((value) => value + 1)}
              >
                <RefreshCw className="h-4 w-4" aria-hidden="true" />
                Retry
              </Button>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
