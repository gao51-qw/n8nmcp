import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const validator = join(root, "deploy/supabase/validate-email-otp-template.sh");
const gitBash = "C:\\Program Files\\Git\\bin\\bash.exe";
const bash = process.platform === "win32" && existsSync(gitBash) ? gitBash : "bash";
const shellPath = (path: string) =>
  process.platform === "win32"
    ? path
        .replace(/^([A-Za-z]):/, (_match, drive: string) => `/${drive.toLowerCase()}`)
        .replace(/\\/g, "/")
    : path;

const validate = (html: string) => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), "n8nmcp-email-otp-"));
  const fixture = join(fixtureRoot, "template.html");
  writeFileSync(fixture, html, { encoding: "utf8", mode: 0o600 });
  try {
    return spawnSync(bash, [shellPath(validator), shellPath(fixture)], { encoding: "utf8" });
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true });
  }
};

describe("email OTP template validator", () => {
  it.each(["{{ .Token }}", "{{.Token}}", "{{  .Token  }}"])(
    "accepts the sole normalized Token action: %s",
    (action) => {
      const result = validate(`<html><body><p>${action}</p></body></html>`);

      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
    },
  );

  it.each([
    ["index action", '{{ index . "ConfirmationURL" }}'],
    ["printf action", '{{ printf "%s" .Token }}'],
    ["pipeline", "{{ .Token | html }}"],
    ["extra action", "{{ .Token }}{{ .SiteURL }}"],
    ["unclosed action", "{{ .Token }"],
    ["stray closing braces", "{{ .Token }} }}"],
    ["anchor", "{{ .Token }}<a>continue</a>"],
    ["href", '{{ .Token }}<p href="/continue">continue</p>'],
    ["src", '{{ .Token }}<img src="cid:tracking">'],
    ["form action", '{{ .Token }}<form action="/verify"></form>'],
    ["protocol-relative URL", "{{ .Token }}<p>//tracker.example/p</p>"],
    ["CSS URL", '{{ .Token }}<p style="background:url(/pixel)">code</p>'],
  ])("rejects %s", (_label, unsafeTemplate) => {
    const result = validate(`<html><body>${unsafeTemplate}</body></html>`);

    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe("");
  });
});
