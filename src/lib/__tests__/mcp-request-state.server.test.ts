import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { vi } from "vitest";
import {
  confirmationFingerprint,
  digestArguments,
  InvalidRequestStateError,
  redeemRequestState,
  REQUEST_STATE_TTL_MS,
  resetRequestStateKeyForTests,
  signRequestState,
  verifyRequestState,
} from "../mcp-request-state.server";

const binding = { userId: "user-1", tool: "delete_workflow", args: { id: "wf-1", force: true } };
const confirmation = {
  key: "confirm",
  fingerprint: confirmationFingerprint({ title: "Delete", description: "Delete wf-1" }),
};

beforeAll(() => {
  vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
  resetRequestStateKeyForTests();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetRequestStateKeyForTests();
});

function expectInvalid(fn: () => unknown, message: string) {
  expect(fn).toThrow(InvalidRequestStateError);
  expect(fn).toThrow(message);
}

describe("MRTR requestState", () => {
  it("round-trips a state for the same user, tool and arguments", () => {
    const state = signRequestState(binding, confirmation);
    expect(verifyRequestState(state, binding)).toMatchObject({
      key: "confirm",
      fingerprint: confirmation.fingerprint,
    });
  });

  it("does not depend on argument key order", () => {
    const state = signRequestState(binding, confirmation);
    expect(() =>
      verifyRequestState(state, { ...binding, args: { force: true, id: "wf-1" } }),
    ).not.toThrow();
    expect(digestArguments({ a: 1, b: { d: 2, c: 3 } })).toBe(
      digestArguments({ b: { c: 3, d: 2 }, a: 1 }),
    );
  });

  it("rejects a state with a modified body or signature", () => {
    const state = signRequestState(binding, confirmation);
    const [body, sig] = state.split(".");
    const forgedBody = Buffer.from(
      JSON.stringify({
        ...JSON.parse(Buffer.from(body, "base64url").toString()),
        sub: "attacker",
      }),
    ).toString("base64url");
    expectInvalid(() => verifyRequestState(`${forgedBody}.${sig}`, binding), "failed verification");
    expectInvalid(() => verifyRequestState(`${body}.${sig.slice(0, -2)}AA`, binding), "failed");
  });

  it.each([
    ["another user", { ...binding, userId: "user-2" }, "different user"],
    ["another tool", { ...binding, tool: "archive_workflow" }, "different request"],
    ["other arguments", { ...binding, args: { id: "wf-2", force: true } }, "different request"],
  ])("rejects a state presented by %s", (_label, other, message) => {
    const state = signRequestState(binding, confirmation);
    expectInvalid(() => verifyRequestState(state, other), message);
  });

  it("rejects an expired state", () => {
    const now = Date.now();
    const state = signRequestState(binding, confirmation, now);
    expectInvalid(
      () => verifyRequestState(state, binding, now + REQUEST_STATE_TTL_MS + 1),
      "expired",
    );
  });

  it("can be redeemed only once", () => {
    const state = signRequestState(binding, confirmation);
    redeemRequestState(verifyRequestState(state, binding));
    expectInvalid(() => verifyRequestState(state, binding), "already been used");
  });

  it.each([undefined, 42, "", "no-dot", "a.b.c", "x".repeat(5000)])(
    "rejects malformed input %#",
    (token) => {
      expect(() => verifyRequestState(token, binding)).toThrow(InvalidRequestStateError);
    },
  );

  it("does not verify under a different signing key", () => {
    const state = signRequestState(binding, confirmation);
    vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 9).toString("base64"));
    resetRequestStateKeyForTests();
    try {
      expectInvalid(() => verifyRequestState(state, binding), "failed verification");
    } finally {
      vi.stubEnv("APP_ENCRYPTION_KEY", Buffer.alloc(32, 7).toString("base64"));
      resetRequestStateKeyForTests();
    }
  });
});
