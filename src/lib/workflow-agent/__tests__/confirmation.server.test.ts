import { describe, expect, it } from "vitest";

import {
  ConfirmationRequiredError,
  createConfirmationService,
  type ConfirmationChallengeInsert,
  type ConfirmationStore,
} from "../confirmation.server";

class FakeConfirmationStore implements ConfirmationStore {
  readonly rows: Array<ConfirmationChallengeInsert & { consumed_at: string | null }> = [];

  async insert(challenge: ConfirmationChallengeInsert): Promise<void> {
    this.rows.push({ ...challenge, consumed_at: null });
  }

  async consume(input: {
    userId: string;
    action: string;
    scopeHash: string;
    tokenHash: string;
    now: string;
  }): Promise<boolean> {
    const row = this.rows.find(
      (candidate) =>
        candidate.user_id === input.userId &&
        candidate.action === input.action &&
        candidate.scope_hash === input.scopeHash &&
        candidate.token_hash === input.tokenHash &&
        candidate.consumed_at === null &&
        candidate.expires_at > input.now,
    );
    if (!row) return false;
    row.consumed_at = input.now;
    return true;
  }
}

async function issue(
  service: ReturnType<typeof createConfirmationService>,
  input: { userId: string; action: string; scope: unknown },
) {
  try {
    await service.requireOrConsume(input);
  } catch (error) {
    expect(error).toBeInstanceOf(ConfirmationRequiredError);
    return error as ConfirmationRequiredError;
  }
  throw new Error("Expected a confirmation challenge");
}

describe("durable workflow confirmation challenges", () => {
  it("stores only hashes and consumes the raw token once", async () => {
    const store = new FakeConfirmationStore();
    const service = createConfirmationService(store, {
      now: () => new Date("2026-07-10T00:00:00.000Z"),
    });
    const input = { userId: "u1", action: "apply", scope: { previewCallId: "p1", selected: [0] } };

    const challenge = await issue(service, input);
    expect(challenge.token).toMatch(/^mcp_confirm_/);
    expect(challenge.expiresAt).toBe("2026-07-10T00:05:00.000Z");
    expect(store.rows[0]?.token_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(store.rows[0]?.scope_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(store.rows[0])).not.toContain(challenge.token);

    await expect(
      service.requireOrConsume({ ...input, confirmationToken: challenge.token }),
    ).resolves.toBeUndefined();

    await expect(
      service.requireOrConsume({ ...input, confirmationToken: challenge.token }),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);
  });

  it("binds tokens to user, action, and canonical scope", async () => {
    const store = new FakeConfirmationStore();
    const service = createConfirmationService(store, {
      now: () => new Date("2026-07-10T00:00:00.000Z"),
    });
    const challenge = await issue(service, {
      userId: "u1",
      action: "rollback",
      scope: { auditLogId: "a1" },
    });

    for (const mismatch of [
      { userId: "u2", action: "rollback", scope: { auditLogId: "a1" } },
      { userId: "u1", action: "apply", scope: { auditLogId: "a1" } },
      { userId: "u1", action: "rollback", scope: { auditLogId: "a2" } },
    ]) {
      await expect(
        service.requireOrConsume({ ...mismatch, confirmationToken: challenge.token }),
      ).rejects.toBeInstanceOf(ConfirmationRequiredError);
    }
  });

  it("rejects expired tokens", async () => {
    const store = new FakeConfirmationStore();
    let now = new Date("2026-07-10T00:00:00.000Z");
    const service = createConfirmationService(store, { now: () => now });
    const input = { userId: "u1", action: "apply", scope: { previewCallId: "p1" } };
    const challenge = await issue(service, input);

    now = new Date("2026-07-10T00:05:01.000Z");
    await expect(
      service.requireOrConsume({ ...input, confirmationToken: challenge.token }),
    ).rejects.toBeInstanceOf(ConfirmationRequiredError);
  });
});
