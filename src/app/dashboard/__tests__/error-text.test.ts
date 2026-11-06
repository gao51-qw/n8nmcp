import { describe, expect, it } from "vitest";
import { errorText } from "@/components/dashboard/error-text";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
  }
}

describe("dashboard errorText", () => {
  it("returns a readable Error message as is", () => {
    expect(errorText(new Error("Instance not reachable"))).toBe("Instance not reachable");
    expect(errorText(new ApiError("Key limit reached", 409, "conflict"))).toBe("Key limit reached");
  });

  it("unwraps a raw JSON body with a string error", () => {
    expect(errorText(new Error('{"error":"Name is required"}'))).toBe("Name is required");
  });

  it("unwraps a raw JSON body with a structured error", () => {
    expect(errorText(new Error('{"error":{"code":"invalid_request","message":"Bad URL"}}'))).toBe(
      "Bad URL",
    );
  });

  it("never shows a JSON body without a readable message", () => {
    expect(errorText(new Error('{"requestId":"r-1"}'), "Try again")).toBe("Try again");
  });

  it("falls back for empty or non-error values", () => {
    expect(errorText(new Error(""), "Try again")).toBe("Try again");
    expect(errorText(undefined, "Try again")).toBe("Try again");
    expect(errorText({ unexpected: true }, "Try again")).toBe("Try again");
    expect(errorText("Plain text")).toBe("Plain text");
  });
});
