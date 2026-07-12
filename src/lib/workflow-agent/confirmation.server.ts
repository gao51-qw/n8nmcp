import { createHash, randomBytes } from "node:crypto";

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import type { TablesInsert } from "@/integrations/supabase/types";

const CONFIRMATION_TTL_MS = 5 * 60_000;

export type ConfirmationChallengeInsert = TablesInsert<"workflow_confirmation_challenges">;

export interface ConfirmationStore {
  insert(challenge: ConfirmationChallengeInsert): Promise<void>;
  consume(input: {
    userId: string;
    action: string;
    scopeHash: string;
    tokenHash: string;
    now: string;
  }): Promise<boolean>;
}

export class ConfirmationRequiredError extends Error {
  readonly code = "confirmation_required";

  constructor(
    public readonly token: string,
    public readonly expiresAt: string,
    public readonly summary: string,
  ) {
    super(`${summary} requires confirmation.`);
    this.name = "ConfirmationRequiredError";
  }
}

const supabaseConfirmationStore: ConfirmationStore = {
  async insert(challenge) {
    const { error } = await supabaseAdmin
      .from("workflow_confirmation_challenges")
      .insert(challenge);
    if (error) throw new Error(`Failed to create confirmation challenge: ${error.message}`);
  },

  async consume(input) {
    const { data, error } = await supabaseAdmin
      .from("workflow_confirmation_challenges")
      .update({ consumed_at: input.now })
      .eq("user_id", input.userId)
      .eq("action", input.action)
      .eq("scope_hash", input.scopeHash)
      .eq("token_hash", input.tokenHash)
      .is("consumed_at", null)
      .gt("expires_at", input.now)
      .select("id")
      .maybeSingle();

    if (error) throw new Error(`Failed to consume confirmation challenge: ${error.message}`);
    return data !== null;
  },
};

export function createConfirmationService(
  store: ConfirmationStore = supabaseConfirmationStore,
  options: { now?: () => Date } = {},
) {
  const now = options.now ?? (() => new Date());

  return {
    async requireOrConsume(input: {
      userId: string;
      action: string;
      scope: unknown;
      confirmationToken?: string;
    }): Promise<void> {
      const current = now();
      const currentIso = current.toISOString();
      const scopeHash = sha256(stableStringify(input.scope));

      if (input.confirmationToken) {
        const consumed = await store.consume({
          userId: input.userId,
          action: input.action,
          scopeHash,
          tokenHash: sha256(input.confirmationToken),
          now: currentIso,
        });
        if (consumed) return;
      }

      const token = `mcp_confirm_${randomBytes(16).toString("base64url")}`;
      const expiresAt = new Date(current.getTime() + CONFIRMATION_TTL_MS).toISOString();
      await store.insert({
        user_id: input.userId,
        action: input.action,
        scope_hash: scopeHash,
        token_hash: sha256(token),
        expires_at: expiresAt,
      });

      throw new ConfirmationRequiredError(token, expiresAt, input.action);
    },
  };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(",")}]`;

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
