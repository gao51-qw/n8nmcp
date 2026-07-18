import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8").replace(/\r\n/g, "\n");

const composeService = (source: string, service: string) => {
  const scopedSource = `${source}\n  __test_end__:\n`;
  const match = scopedSource.match(
    new RegExp(`^  ${service}:\\n[\\s\\S]*?(?=^  [a-zA-Z0-9_-]+:)`, "m"),
  );
  expect(match, `missing Compose service: ${service}`).not.toBeNull();
  return match![0];
};

const expectInOrder = (source: string, fragments: string[]) => {
  let previous = -1;
  for (const fragment of fragments) {
    const current = source.indexOf(fragment, previous + 1);
    expect(current, `missing or out-of-order fragment: ${fragment}`).toBeGreaterThan(previous);
    previous = current;
  }
};

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

  it("versions an OTP-only Supabase Auth mail template", () => {
    const otpTemplate = read("deploy/supabase/templates/magic-link-otp.html");

    const variables = [...otpTemplate.matchAll(/{{\s*\.([A-Za-z0-9_]+)\s*}}/g)].map(
      ([, variable]) => variable,
    );

    expect(otpTemplate).toContain("{{ .Token }}");
    expect(variables).toEqual(["Token"]);
    expect(otpTemplate).not.toMatch(
      /\.ConfirmationURL|href\s*=|src\s*=|action\s*=|https?:\/\/|<img\b|tracking|pixel/i,
    );
  });

  it("serves the OTP template privately and waits for readiness", () => {
    const otpCompose = read("deploy/supabase/docker-compose.email-otp.yml");
    const templateService = composeService(otpCompose, "auth-email-templates");

    expect(templateService).toContain("image: caddy:2.8-alpine");
    expect(templateService).toContain("healthcheck:");
    expect(templateService).toContain("http://127.0.0.1/magic-link-otp.html");
    expect(templateService).toContain(":/usr/share/caddy/magic-link-otp.html:ro");
    expect(templateService).toMatch(/networks:\n\s+- default/);
    expect(templateService).not.toMatch(/^\s+ports:/m);
  });

  it("extends Auth without replacing its image and configures both OTP paths", () => {
    const otpCompose = read("deploy/supabase/docker-compose.email-otp.yml");
    const authService = composeService(otpCompose, "auth");

    expect(authService).not.toMatch(/^\s+(?:image|build):/m);
    expect(authService).toContain("condition: service_healthy");
    expect(authService).toContain(
      "GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: http://auth-email-templates/magic-link-otp.html",
    );
    expect(authService).toContain(
      "GOTRUE_MAILER_TEMPLATES_CONFIRMATION: http://auth-email-templates/magic-link-otp.html",
    );
    expect(authService).toContain("GOTRUE_MAILER_SUBJECTS_MAGIC_LINK:");
    expect(authService).toContain("GOTRUE_MAILER_SUBJECTS_CONFIRMATION:");
    expect(authService).toContain('GOTRUE_MAILER_OTP_LENGTH: "6"');
  });

  it("validates the served template before recreating Auth", () => {
    const installer = read("deploy/supabase/install-email-otp-aapanel.sh");

    expect(installer).toContain('"${OTP_COMPOSE_COMMAND[@]}" config --quiet');
    expect(installer).toContain("validate_email_otp_template");
    expect(installer).toContain('source "$TEMPLATE_VALIDATOR"');
    expect(installer).toContain("sha256sum");
    expectInOrder(installer, [
      '"${OTP_COMPOSE_COMMAND[@]}" up -d --no-deps --force-recreate auth-email-templates',
      'wait_for_template_ready "$SOURCE_TEMPLATE" 120 require-health',
      '"${OTP_COMPOSE_COMMAND[@]}" up -d --no-deps --force-recreate auth',
      "wait_for_auth_healthy 120",
      "verify_auth_template_configuration",
    ]);
  });

  it("verifies both Auth template URLs and the six-digit OTP contract", () => {
    const installer = read("deploy/supabase/install-email-otp-aapanel.sh");

    expect(installer).toContain(
      "GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=http://auth-email-templates/magic-link-otp.html",
    );
    expect(installer).toContain(
      "GOTRUE_MAILER_TEMPLATES_CONFIRMATION=http://auth-email-templates/magic-link-otp.html",
    );
    expect(installer).toContain("GOTRUE_MAILER_OTP_LENGTH=6");
  });

  it("rolls back only once from the top level and preserves absence metadata", () => {
    const installer = read("deploy/supabase/install-email-otp-aapanel.sh");

    expect(installer).toContain("if (( BASH_SUBSHELL > 0 )); then");
    expect(installer).toContain("rollback_started=0");
    expect(installer).toContain("if (( rollback_started )); then");
    expect(installer).toContain("validate_backup");
    expect(installer).toContain("template.absent");
    expect(installer).toContain("override.absent");
    expect(installer).toContain("template.metadata");
    expect(installer).toContain("override.metadata");
  });

  it("fails closed and restores template readiness before Auth during rollback", () => {
    const installer = read("deploy/supabase/install-email-otp-aapanel.sh");
    const rollback = installer.slice(
      installer.indexOf("rollback() {"),
      installer.indexOf("on_error() {"),
    );

    expectInOrder(rollback, [
      "ensure_auth_stopped",
      "stop_template_containers",
      "restore_backup",
      '"${rollback_compose[@]}" config --quiet',
      "up -d --no-deps --force-recreate auth-email-templates",
      "wait_for_template_ready",
      "up -d --no-deps --force-recreate auth",
      "wait_for_auth_healthy 120",
    ]);
    expect(rollback).toMatch(
      /if ! "\$\{rollback_compose\[@\]\}" config --quiet; then\n\s+return 1/,
    );
  });

  it("revalidates a restored remote OTP template before restarting Auth", () => {
    const installer = read("deploy/supabase/install-email-otp-aapanel.sh");
    const rollback = installer.slice(
      installer.indexOf("rollback() {"),
      installer.indexOf("on_error() {"),
    );

    expectInOrder(rollback, [
      "restored_remote_otp_enabled",
      'validate_email_otp_template "$TARGET_TEMPLATE"',
      "up -d --no-deps --force-recreate auth-email-templates",
      'wait_for_template_ready "$TARGET_TEMPLATE" 120 require-http-readiness',
      "up -d --no-deps --force-recreate auth",
    ]);
    expect(rollback).not.toContain("allow-missing-health");
  });

  it("confirms Auth is stopped before normal and rollback template mutation", () => {
    const installer = read("deploy/supabase/install-email-otp-aapanel.sh");
    const deployment = installer.slice(
      installer.indexOf("mutation_started=1"),
      installer.indexOf("mutation_started=0", installer.indexOf("mutation_started=1")),
    );
    const rollback = installer.slice(
      installer.indexOf("rollback() {"),
      installer.indexOf("on_error() {"),
    );

    expect(installer).toContain("ensure_auth_stopped() {");
    expect(installer).not.toContain('docker stop "$AUTH_CONTAINER" >/dev/null || true');
    expectInOrder(deployment, [
      "ensure_auth_stopped",
      'install -m 0644 -o root -g root -- "$SOURCE_TEMPLATE" "$TARGET_TEMPLATE"',
      "auth-email-templates",
    ]);
    expectInOrder(rollback, ["ensure_auth_stopped", "stop_template_containers", "restore_backup"]);
  });

  it("removes stopped template containers during rollback", () => {
    const installer = read("deploy/supabase/install-email-otp-aapanel.sh");
    const cleanup = installer.slice(
      installer.indexOf("stop_template_containers() {"),
      installer.indexOf("rollback() {"),
    );

    expect(cleanup).toContain("docker ps -aq");
    expect(cleanup).toContain('docker rm -f "$container_id"');
  });

  it("documents separate existing/new-user acceptance and polled rollback health", () => {
    const runbook = read("deploy/MAIL.md");

    expect(runbook).toContain("Existing user");
    expect(runbook).toContain("New user");
    expect(runbook).toContain("shouldCreateUser: true");
    expect(runbook).toContain("same code again");
    expect(runbook).toContain("attempt <= 120");
    expect(runbook).toContain("template.metadata");
    expect(runbook).toContain("override.metadata");
    expect(runbook).toContain(
      "Stop Auth first, then stop and remove the template service; recreate only the two affected services",
    );
  });

  it("documents strict restored-template gates before manual Auth restart", () => {
    const runbook = read("deploy/MAIL.md");
    const manualRollback = runbook.slice(runbook.indexOf("#### Independent OTP template rollback"));

    expectInOrder(manualRollback, [
      "REMOTE_OTP_ENABLED=0",
      "validate-email-otp-template.sh",
      "up -d --no-deps --force-recreate auth-email-templates",
      "wget -q -O -",
      "cmp -s",
      "sha256sum",
      "up -d --no-deps --force-recreate auth",
    ]);
    expect(manualRollback).toContain(
      "restored state does not enable the managed remote OTP template",
    );
  });
});
