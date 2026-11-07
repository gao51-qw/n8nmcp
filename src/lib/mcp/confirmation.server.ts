// Confirmation for destructive MCP tools: elicitation when the client supports
// it, else a durable owner-scoped confirmation token (server-only).
import { createExpiringStore } from "@/lib/expiring-store";
import { randomBytes } from "node:crypto";
import {
  ConfirmationRequiredError,
  createConfirmationService,
} from "@/lib/workflow-agent/confirmation.server";
import { stableStringify } from "./fingerprint";
import type { ElicitationRequest, ToolContext } from "./types";

export class ElicitationRequiredError extends Error {
  constructor(
    public readonly elicitationId: string,
    public readonly request: ElicitationRequest,
  ) {
    super(`Elicitation required for ${request.title} (${elicitationId})`);
  }
}

const TEST_CONFIRMATION_TOKEN_TTL_MS = 5 * 60_000;
// Only reachable without an authenticated caller (direct runTool unit tests);
// production refuses that path, see requireConfirmation().
const testOnlyConfirmationChallenges = createExpiringStore<{ token: string }>({
  maxEntries: 1_000,
});

const confirmationService = createConfirmationService();

async function capableOfElicitation(context?: ToolContext): Promise<boolean> {
  return !!(
    context?.clientCapabilities?.elicitation && typeof context.requestElicitation === "function"
  );
}

async function requestUserConfirmation(
  context: ToolContext | undefined,
  operation: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  if (!context?.requestElicitation || !context.clientCapabilities?.elicitation) {
    return false;
  }

  try {
    const response = await context.requestElicitation({
      title: operation,
      description: `Please confirm operation on ${String(args.id ?? args.workflowId ?? "target resource")}.`,
      schema: {
        type: "object",
        properties: {
          confirm: {
            type: "boolean",
            title: "Confirm this action",
            description: "Set true to proceed.",
          },
        },
        required: ["confirm"],
      },
    });
    return response.confirm === true;
  } catch (error) {
    if (error instanceof ElicitationRequiredError) {
      throw error;
    }
    return false;
  }
}

export async function requireConfirmation(
  args: Record<string, unknown>,
  operation: string,
  opts: { requireToken?: boolean; scope?: unknown } = {},
  context?: ToolContext,
): Promise<void> {
  if (context?.confirmationVerified) return;
  if (opts.requireToken && (await capableOfElicitation(context))) {
    const confirmed = await requestUserConfirmation(context, operation, args);
    if (!confirmed) {
      throw new Error(`${operation} requires user confirmation via elicitation flow.`);
    }
    return;
  }

  if (opts.requireToken) {
    const authenticatedUserId = (context as (ToolContext & { user_id?: string }) | undefined)
      ?.user_id;
    const scope = opts.scope ?? { id: args.id ?? args.workflowId ?? "" };

    if (authenticatedUserId) {
      try {
        await confirmationService.requireOrConsume({
          userId: authenticatedUserId,
          action: operation,
          scope,
          confirmationToken:
            args.confirm === true && typeof args.confirmationToken === "string"
              ? args.confirmationToken
              : undefined,
        });
        return;
      } catch (error) {
        if (!(error instanceof ConfirmationRequiredError)) throw error;
        if (args.confirm === true) {
          throw new Error(
            `${operation} requires a valid confirmation token. Re-send with ` +
              `{"confirm": true, "confirmationToken": "${error.token}"} to proceed.`,
          );
        }
        throw new Error(
          `${operation} requires confirmation. Re-send with ` +
            `{"confirm": true, "confirmationToken": "${error.token}"} to proceed.`,
        );
      }
    }

    // Direct runTool unit tests do not have an authenticated caller. Keep their
    // compatibility challenge process-local; all production dispatches use the
    // durable, owner-scoped service above. A process-local challenge would not
    // survive a second replica (and is not owner-scoped), so production
    // refuses to issue one.
    if (process.env.NODE_ENV === "production") {
      throw new Error(`${operation} requires an authenticated caller.`);
    }
    const challengeKey = `${operation}:${stableStringify(scope)}`;
    const existing = testOnlyConfirmationChallenges.get(challengeKey);

    if (
      args.confirm === true &&
      typeof args.confirmationToken === "string" &&
      existing?.token === args.confirmationToken
    ) {
      testOnlyConfirmationChallenges.delete(challengeKey);
      return;
    }

    const token = `mcp_confirm_${randomBytes(16).toString("base64url")}`;
    testOnlyConfirmationChallenges.set(challengeKey, { token }, TEST_CONFIRMATION_TOKEN_TTL_MS);

    if (args.confirm === true) {
      throw new Error(
        `${operation} requires a valid confirmation token. Re-send with ` +
          `{"confirm": true, "confirmationToken": "${token}"} to proceed.`,
      );
    }

    throw new Error(
      `${operation} requires confirmation. Re-send with ` +
        `{"confirm": true, "confirmationToken": "${token}"} to proceed.`,
    );
  }

  if (args.confirm !== true) {
    throw new Error(`${operation} requires confirmation. Re-send with "confirm": true to proceed.`);
  }
}
