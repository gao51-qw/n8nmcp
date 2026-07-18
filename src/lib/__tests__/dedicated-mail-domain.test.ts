import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

describe("dedicated mail identity", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("defaults public mail links to server@n8nworkflow.com", async () => {
    vi.stubEnv("NEXT_PUBLIC_SECURITY_EMAIL", "");
    const contact = await import("@/lib/site-contact");

    expect(contact.SITE_CONTACT_EMAIL).toBe("server@n8nworkflow.com");
    expect(contact.SITE_CONTACT_MAILTO).toBe("mailto:server@n8nworkflow.com");
  });

  it("uses the configured public mailbox when supplied", async () => {
    vi.stubEnv("NEXT_PUBLIC_SECURITY_EMAIL", "ops@example.test");
    const contact = await import("@/lib/site-contact");

    expect(contact.SITE_CONTACT_EMAIL).toBe("ops@example.test");
    expect(contact.SITE_CONTACT_MAILTO).toBe("mailto:ops@example.test");
  });

  it("removes retired public mailbox identities from active source", () => {
    const activeFiles = [
      "src/components/marketing-footer.tsx",
      "src/lib/seo-jsonld.ts",
      "src/i18n/locales/docs/de.ts",
      "src/i18n/locales/docs/en.ts",
      "src/i18n/locales/docs/es.ts",
      "src/i18n/locales/docs/ja.ts",
      "src/i18n/locales/docs/zh.ts",
    ];
    const source = activeFiles.map(read).join("\n");

    expect(source).not.toContain("hello@n8nmcp.app");
    expect(source).not.toContain("support@n8nmcp.app");
    expect(source).not.toContain("security@n8nworkflow.com");
  });

  it("pins production templates to the dedicated sender", () => {
    for (const path of ["deploy/.env.app.example", "deploy/configure-aapanel-env.sh"]) {
      const source = read(path);
      expect(source).toContain("NEXT_PUBLIC_SECURITY_EMAIL=server@n8nworkflow.com");
      expect(source).toContain("SUPPORT_EMAIL_FROM=server@n8nworkflow.com");
      expect(source).not.toContain("NEXT_PUBLIC_SECURITY_EMAIL=security@n8nworkflow.com");
    }
  });

  it("documents the complete production mail contract", () => {
    const runbook = read("deploy/MAIL.md");
    for (const required of [
      "server@n8nworkflow.com",
      "server.n8nworkflow.com",
      "159.195.40.97",
      "SMTP_PORT=465",
      "SMTP_ADMIN_EMAIL=server@n8nworkflow.com",
      "GOTRUE_SMTP_HOST=server.n8nworkflow.com",
      "GOTRUE_SMTP_PORT=465",
      "Resend",
      "SPF",
      "DKIM",
      "DMARC",
      "Rollback",
    ]) {
      expect(runbook).toContain(required);
    }

    expect(runbook).toContain(
      [
        "server.n8nworkflow.com.  A    159.195.40.97   DNS only",
        "n8nworkflow.com.         MX   10 server.n8nworkflow.com.",
      ].join("\n"),
    );
    expect(runbook).toContain(
      "Keep the SMTP host **DNS only**; do not proxy it through Cloudflare.",
    );
    expect(runbook).toContain(
      "Use port 587 with STARTTLS only as a documented\nfallback for a client that cannot use 465",
    );
    expect(runbook).toContain(
      "Copy every record name, type, and value verbatim. Never guess\na value or merge multiple provider values by hand.",
    );
    expect(runbook).toContain("hidden prompt (`read -rsp`)");
    expect(runbook).toContain("pass the value through standard input, and `unset`");
    expect(runbook).toContain("Do not use `echo`, command-line password flags");

    for (const backupRequirement of [
      "BILLIONMAIL_ROOT=/opt/BillionMail",
      'sudo test -d "$BILLIONMAIL_ROOT"',
      'sudo test -r "$MAIL_BACKUP/billionmail"',
      'sudo test -s "$MAIL_BACKUP/app.env"',
      "mode `0700`",
      "mode `0600`",
      "Stop before any DNS or runtime mutation if any backup verification fails.",
    ]) {
      expect(runbook).toContain(backupRequirement);
    }

    const manifestCommand =
      "find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero";
    expect(runbook.split(manifestCommand)).toHaveLength(5);
    for (const manifest of [
      "billionmail.source.sha256",
      "billionmail.destination.sha256",
      "supabase-auth.source.sha256",
      "supabase-auth.destination.sha256",
    ]) {
      expect(runbook).toContain(
        `sudo install -m 0600 -o root -g root /dev/null "$MAIL_BACKUP/${manifest}"`,
      );
    }
    expect(runbook).toContain(
      'sudo cmp -s "$MAIL_BACKUP/billionmail.source.sha256" "$MAIL_BACKUP/billionmail.destination.sha256"',
    );
    expect(runbook).toContain(
      'sudo cmp -s "$MAIL_BACKUP/supabase-auth.source.sha256" "$MAIL_BACKUP/supabase-auth.destination.sha256"',
    );
    expect(runbook).toContain('sudo cmp -s /opt/n8nmcp-app/deploy/.env.app "$MAIL_BACKUP/app.env"');
    expect(runbook).toContain(
      'OWNERSHIP_MISMATCH="$(sudo find "$MAIL_BACKUP" \\( ! -user root -o ! -group root \\) -print -quit)"',
    );
    expect(runbook).toContain('test -z "$OWNERSHIP_MISMATCH"');
    expect(runbook).toContain("unset OWNERSHIP_MISMATCH");
    expect(runbook).not.toContain(
      'sudo find "$MAIL_BACKUP" ! -user root -o ! -group root | grep -q .',
    );

    expect(runbook).toMatch(
      /external Gmail[\s\S]*SPF is PASS[\s\S]*DKIM is PASS[\s\S]*DMARC is PASS/i,
    );
    expect(runbook).toContain(
      "Resend logs must prove that the direct BillionMail submission used the intended relay and port (2465 or 2587).",
    );
    expect(runbook).toContain("Rollback is service-specific. Restore only the component changed");
    for (const service of [
      "**DNS:**",
      "**BillionMail/TLS/relay:**",
      "**Supabase Auth:**",
      "**App:**",
    ]) {
      expect(runbook).toContain(service);
    }

    expect(read("deploy/README.md")).toContain("[Dedicated mail domain](./MAIL.md)");
  });
});
