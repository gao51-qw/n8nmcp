import { describe, expect, it } from "vitest";
import { fragmentWithoutTokens, parseEmailLinkFragment } from "../email-link";

describe("email link fragment", () => {
  it("parses the implicit-flow tokens", () => {
    expect(
      parseEmailLinkFragment(
        "#access_token=eyJ.a.b&expires_at=1&expires_in=3600&refresh_token=rt1&token_type=bearer&type=recovery",
      ),
    ).toEqual({ access_token: "eyJ.a.b", refresh_token: "rt1", type: "recovery" });
  });

  it("returns null without both tokens or with malformed ones", () => {
    expect(parseEmailLinkFragment("")).toBeNull();
    expect(parseEmailLinkFragment("#access_token=a")).toBeNull();
    expect(parseEmailLinkFragment("#error=access_denied&error_description=expired")).toBeNull();
    expect(parseEmailLinkFragment("#access_token=a%20b&refresh_token=c")).toBeNull();
  });

  it("strips token parameters but keeps errors", () => {
    expect(fragmentWithoutTokens("#access_token=a&refresh_token=b&type=signup")).toBe("");
    expect(fragmentWithoutTokens("#access_token=a&error_description=Link+expired")).toBe(
      "#error_description=Link+expired",
    );
  });
});
