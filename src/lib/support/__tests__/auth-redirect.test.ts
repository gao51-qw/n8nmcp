import { describe, expect, it } from "vitest";
import { getSafeLoginDestination } from "@/lib/support/auth/login-redirect";

describe("getSafeLoginDestination", () => {
  it.each(["/dashboard", "/dashboard?tab=billing", "/support/tickets/123#reply"])(
    "allows same-site absolute path %s",
    (nextPath) => {
      expect(getSafeLoginDestination(nextPath)).toBe(nextPath);
    },
  );

  it.each([
    null,
    "",
    "dashboard",
    "//evil.example",
    "https://evil.example/dashboard",
    "/\\evil.example",
    "/%5Cevil.example",
    "/%2F%2Fevil.example",
    "/dashboard\nSet-Cookie: session=evil",
    "/dashboard%0D%0ASet-Cookie:%20session=evil",
  ])("falls back for unsafe next destination %s", (nextPath) => {
    expect(getSafeLoginDestination(nextPath)).toBe("/dashboard");
  });
});
