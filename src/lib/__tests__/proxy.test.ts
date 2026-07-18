import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { proxy } from "@/proxy";

describe("domain proxy", () => {
  it("keeps the shared login route on the dashboard domain", () => {
    const request = new NextRequest("https://dashboard.n8nworkflow.com/login?next=%2F", {
      headers: { host: "dashboard.n8nworkflow.com" },
    });

    const response = proxy(request);

    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
    expect(response.headers.get("x-robots-tag")).toBe("noindex,nofollow");
  });
});
