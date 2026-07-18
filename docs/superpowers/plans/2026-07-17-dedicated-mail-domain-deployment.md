# Dedicated Mail Domain Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `server@n8nworkflow.com` the project's public and transactional sender, use `server.n8nworkflow.com` for SMTP submission, and deploy the verified root Next.js application and mail configuration to the existing VPS.

**Architecture:** Keep the existing BillionMail instance and add an isolated `n8nworkflow.com` mail domain and mailbox. Supabase Auth submits through BillionMail on TLS port 465, BillionMail relays externally through the already-selected provider because direct outbound port 25 is blocked, and the Next.js support worker continues to use the Resend API with the same verified sender identity.

**Tech Stack:** Next.js 16, TypeScript, Vitest, Docker Compose, aaPanel, BillionMail/Postfix/Dovecot, self-hosted Supabase Auth, Resend relay/API, public DNS.

## Global Constraints

- Use npm 11.6.2 only for repository package management.
- Preserve every unrelated staged, modified, deleted, and untracked path in the dirty working tree.
- Never commit or print mailbox passwords, Resend keys, Supabase secrets, API tokens, or service credentials.
- The only application target is the root Next.js standalone image; do not add Vercel, Cloudflare Worker, legacy Express, or split-runtime deployment paths.
- Use `server@n8nworkflow.com` for public contact, security contact, support notification From, and Supabase Auth From.
- Use `server.n8nworkflow.com:465` with implicit TLS for SMTP submission; port 587 with STARTTLS is fallback only.
- Keep Cloudflare proxying disabled for the SMTP hostname and MX path.
- External delivery is not accepted until a message reaches a real external inbox and passes SPF, DKIM, and DMARC evaluation.
- Validation errors block deployment; missing DNS control, relay credentials, or domain verification blocks production completion.

---

## File Structure

- Create `src/lib/site-contact.ts`: one public email identity and `mailto:` value for React and SEO consumers.
- Create `src/lib/__tests__/dedicated-mail-domain.test.ts`: behavior and repository-contract tests for the dedicated address and deployment documentation.
- Modify `src/components/marketing-footer.tsx`: consume the shared public mailbox for both contact links.
- Modify `src/lib/seo-jsonld.ts`: consume the shared mailbox as the security-contact fallback.
- Modify `src/i18n/locales/docs/{de,en,es,ja,zh}.ts`: publish the approved mailbox in vulnerability-reporting copy.
- Modify `deploy/.env.app.example`: document the exact non-secret sender values.
- Modify `deploy/configure-aapanel-env.sh`: generate the approved public and support sender defaults.
- Create `deploy/MAIL.md`: production DNS, TLS, BillionMail, relay, Supabase Auth, validation, and rollback runbook.
- Modify `deploy/README.md`: link the mail runbook from the active VPS documentation.

### Task 1: Centralize the public mail identity

**Files:**
- Create: `src/lib/site-contact.ts`
- Create: `src/lib/__tests__/dedicated-mail-domain.test.ts`
- Modify: `src/components/marketing-footer.tsx`
- Modify: `src/lib/seo-jsonld.ts`

**Interfaces:**
- Produces: `SITE_CONTACT_EMAIL: string` and `SITE_CONTACT_MAILTO: string`.
- Consumes: optional build/runtime variable `NEXT_PUBLIC_SECURITY_EMAIL`.

- [ ] **Step 1: Write the failing contact-identity tests**

Create `src/lib/__tests__/dedicated-mail-domain.test.ts` with:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

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
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```powershell
npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts
```

Expected: FAIL because `@/lib/site-contact` does not exist and the retired addresses remain in active source.

- [ ] **Step 3: Add the minimal shared contact module**

Create `src/lib/site-contact.ts` with:

```ts
const DEFAULT_SITE_CONTACT_EMAIL = "server@n8nworkflow.com";

export const SITE_CONTACT_EMAIL =
  process.env.NEXT_PUBLIC_SECURITY_EMAIL?.trim() || DEFAULT_SITE_CONTACT_EMAIL;

export const SITE_CONTACT_MAILTO = `mailto:${SITE_CONTACT_EMAIL}`;
```

- [ ] **Step 4: Wire React and SEO consumers**

In `src/components/marketing-footer.tsx`, import `SITE_CONTACT_MAILTO` from
`@/lib/site-contact` and replace both literal `mailto:` values with
`SITE_CONTACT_MAILTO`.

In `src/lib/seo-jsonld.ts`, import `SITE_CONTACT_EMAIL` and replace:

```ts
email: process.env.NEXT_PUBLIC_SECURITY_EMAIL || "security@n8nworkflow.com",
```

with:

```ts
email: SITE_CONTACT_EMAIL,
```

- [ ] **Step 5: Run the focused test and confirm the remaining expected RED**

Run:

```powershell
npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts
```

Expected: the module behavior passes, while the retired-address scan still fails on the five docs locale files.

- [ ] **Step 6: Update all vulnerability-reporting locale copies**

In each of `src/i18n/locales/docs/de.ts`, `en.ts`, `es.ts`, `ja.ts`, and `zh.ts`, replace the literal `security@n8nworkflow.com` with `server@n8nworkflow.com` without changing any other translated copy.

- [ ] **Step 7: Run focused tests and confirm GREEN**

Run:

```powershell
npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts src/lib/__tests__/site-domains.test.ts
```

Expected: both test files pass with zero failures.

- [ ] **Step 8: Commit the isolated source change**

```powershell
git add -- src/lib/site-contact.ts src/lib/__tests__/dedicated-mail-domain.test.ts src/components/marketing-footer.tsx src/lib/seo-jsonld.ts src/i18n/locales/docs/de.ts src/i18n/locales/docs/en.ts src/i18n/locales/docs/es.ts src/i18n/locales/docs/ja.ts src/i18n/locales/docs/zh.ts
git commit --only -m "feat: unify dedicated project mailbox" -- src/lib/site-contact.ts src/lib/__tests__/dedicated-mail-domain.test.ts src/components/marketing-footer.tsx src/lib/seo-jsonld.ts src/i18n/locales/docs/de.ts src/i18n/locales/docs/en.ts src/i18n/locales/docs/es.ts src/i18n/locales/docs/ja.ts src/i18n/locales/docs/zh.ts
```

Expected: only the listed paths are committed; unrelated staged work remains staged and unchanged.

### Task 2: Lock deployment defaults to the approved mailbox

**Files:**
- Modify: `src/lib/__tests__/dedicated-mail-domain.test.ts`
- Modify: `deploy/.env.app.example`
- Modify: `deploy/configure-aapanel-env.sh`

**Interfaces:**
- Produces: `NEXT_PUBLIC_SECURITY_EMAIL=server@n8nworkflow.com` and `SUPPORT_EMAIL_FROM=server@n8nworkflow.com` in both active production templates.
- Consumes: the existing `.env` and `.env.app` generation contract under `/opt/n8nmcp-app/deploy`.

- [ ] **Step 1: Add a failing deployment-default test**

Append inside the existing `describe("dedicated mail identity", ...)` block:

```ts
it("pins production templates to the dedicated sender", () => {
  for (const path of ["deploy/.env.app.example", "deploy/configure-aapanel-env.sh"]) {
    const source = read(path);
    expect(source).toContain("NEXT_PUBLIC_SECURITY_EMAIL=server@n8nworkflow.com");
    expect(source).toContain("SUPPORT_EMAIL_FROM=server@n8nworkflow.com");
    expect(source).not.toContain("NEXT_PUBLIC_SECURITY_EMAIL=security@n8nworkflow.com");
  }
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```powershell
npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts
```

Expected: FAIL because both deployment inputs still use empty or retired sender values.

- [ ] **Step 3: Update the non-secret deployment defaults**

Apply these exact values:

```dotenv
NEXT_PUBLIC_SECURITY_EMAIL=server@n8nworkflow.com
SUPPORT_EMAIL_FROM=server@n8nworkflow.com
```

Use them in `deploy/.env.app.example` and in both generated environment sections of `deploy/configure-aapanel-env.sh`. Do not add any password, API key, or SMTP credential.

- [ ] **Step 4: Run deployment-contract tests and confirm GREEN**

Run:

```powershell
npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts src/lib/__tests__/next-architecture-guards.test.ts
```

Expected: both test files pass with zero failures.

- [ ] **Step 5: Commit the deployment defaults**

```powershell
git add -- src/lib/__tests__/dedicated-mail-domain.test.ts deploy/.env.app.example deploy/configure-aapanel-env.sh
git commit --only -m "deploy: set dedicated mail sender defaults" -- src/lib/__tests__/dedicated-mail-domain.test.ts deploy/.env.app.example deploy/configure-aapanel-env.sh
```

### Task 3: Add an executable production mail runbook contract

**Files:**
- Modify: `src/lib/__tests__/dedicated-mail-domain.test.ts`
- Create: `deploy/MAIL.md`
- Modify: `deploy/README.md`

**Interfaces:**
- Produces: an operator contract for DNS, TLS, BillionMail, relay, Supabase Auth, app runtime, acceptance, and rollback.
- Consumes: VPS address `159.195.40.97`, app directory `/opt/n8nmcp-app`, and the existing BillionMail runtime.

- [ ] **Step 1: Add a failing runbook-contract test**

Append inside the existing describe block:

```ts
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
  expect(read("deploy/README.md")).toContain("[Dedicated mail domain](./MAIL.md)");
});
```

- [ ] **Step 2: Run the test and confirm RED**

Run:

```powershell
npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts
```

Expected: FAIL because `deploy/MAIL.md` does not exist.

- [ ] **Step 3: Write `deploy/MAIL.md` with exact non-secret configuration**

The runbook must include these exact DNS records as the initial routing set:

```txt
server.n8nworkflow.com.  A    159.195.40.97   DNS only
n8nworkflow.com.         MX   10 server.n8nworkflow.com.
```

It must state that SPF, DKIM, and DMARC values are copied verbatim from the verified Resend/BillionMail domain screens, never guessed or merged by hand. It must document this Supabase Auth configuration:

```dotenv
GOTRUE_SMTP_HOST=server.n8nworkflow.com
GOTRUE_SMTP_PORT=465
GOTRUE_SMTP_USER=server@n8nworkflow.com
GOTRUE_SMTP_ADMIN_EMAIL=server@n8nworkflow.com
GOTRUE_SMTP_SENDER_NAME=n8nworkflow
```

It must document `SMTP_PORT=465` for the BillionMail submission endpoint, implicit TLS, port 587 as fallback only, Resend relay on 2465 or 2587, secure secret prompting, backup locations, DNS/TLS commands, external Gmail delivery checks, and service-specific rollback.

- [ ] **Step 4: Link the runbook from the active deployment guide**

Add this sentence near the top of `deploy/README.md`:

```markdown
For the production sender, SMTP hostname, DNS records, and delivery gates, follow [Dedicated mail domain](./MAIL.md).
```

- [ ] **Step 5: Run the focused test and confirm GREEN**

Run:

```powershell
npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts
```

Expected: PASS with zero failures.

- [ ] **Step 6: Commit the runbook**

```powershell
git add -- src/lib/__tests__/dedicated-mail-domain.test.ts deploy/MAIL.md deploy/README.md
git commit --only -m "docs: add dedicated mail production runbook" -- src/lib/__tests__/dedicated-mail-domain.test.ts deploy/MAIL.md deploy/README.md
```

### Task 4: Verify the repository artifact before production mutation

**Files:**
- Verify only; no new files.

**Interfaces:**
- Consumes: Tasks 1-3 commits.
- Produces: a buildable root Next.js deployment artifact with recorded verification evidence.

- [ ] **Step 1: Confirm the scoped diff and dirty-tree preservation**

Run:

```powershell
git diff --check HEAD~3..HEAD
git diff --name-only HEAD~3..HEAD
git status --short
```

Expected: the three commits contain only the files listed in Tasks 1-3; pre-existing unrelated changes remain present and were not folded into these commits.

- [ ] **Step 2: Run focused tests**

```powershell
npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts src/lib/__tests__/next-architecture-guards.test.ts src/lib/__tests__/site-domains.test.ts src/lib/support/__tests__/notifications.server.test.ts
```

Expected: all selected tests pass with zero failures.

- [ ] **Step 3: Run the complete root verification suite**

```powershell
npm run lint
npm run type-check
npm test
npm run build
```

Expected: every command exits 0. Do not proceed to production if any command fails.

- [ ] **Step 4: Record the deployable commit**

```powershell
git rev-parse HEAD
git log -4 --oneline
```

Expected: the returned immutable SHA contains the approved design and all three implementation commits.

### Task 5: Provision DNS, TLS, the BillionMail domain, and the relay

**Files:**
- Operational change only; no repository files.

**Interfaces:**
- Produces: a trusted SMTP endpoint at `server.n8nworkflow.com:465`, mailbox `server@n8nworkflow.com`, and authenticated external relay.
- Consumes: DNS control for `n8nworkflow.com`, BillionMail admin access, and an existing Resend account with the domain verified.

- [ ] **Step 1: Capture a redacted production inventory and backups**

Use aaPanel/BillionMail read operations to record container names and health, existing mail domains/mailboxes, certificate subjects and expiry, relay enabled/disabled state, and current Supabase Auth SMTP host/user without credential values. Create timestamped backups of the BillionMail configuration and Supabase environment before mutation. Stop if any backup cannot be read back.

- [ ] **Step 2: Add the two initial DNS routing records**

Create exactly:

```txt
server.n8nworkflow.com.  A    159.195.40.97   DNS only
n8nworkflow.com.         MX   10 server.n8nworkflow.com.
```

Expected: authoritative DNS returns the VPS address and MX target. Do not enable Cloudflare proxying for `server.n8nworkflow.com`.

- [ ] **Step 3: Add and verify sender-authentication records**

In Resend, add `n8nworkflow.com` and copy its exact SPF and DKIM records into authoritative DNS. Add `_dmarc.n8nworkflow.com` with monitoring policy `v=DMARC1; p=none`. Wait until Resend reports the domain verified and public resolvers return SPF, DKIM, and DMARC. Do not continue while any record is pending or conflicting.

- [ ] **Step 4: Add the BillionMail domain and mailbox**

Through the BillionMail management API/UI, add `n8nworkflow.com`, then create `server@n8nworkflow.com` with a generated high-entropy password, 1 GB quota, active status, and administrator status disabled. Store the password only in the server secret store and the approved password manager.

- [ ] **Step 5: Issue and bind the SMTP certificate**

Issue a publicly trusted certificate containing `server.n8nworkflow.com`, extend the existing daily certificate-sync mechanism to the new certificate, back up the current Postfix/Dovecot certificate files, install the new certificate, and reload only the affected mail services.

Verify from an external client:

```bash
openssl s_client -connect server.n8nworkflow.com:465 -servername server.n8nworkflow.com -verify_return_error </dev/null
```

Expected: `Verify return code: 0 (ok)` and the certificate SAN contains `server.n8nworkflow.com`.

- [ ] **Step 6: Configure and verify the external relay**

Configure BillionMail to authenticate to Resend using host `smtp.resend.com`, username `resend`, SSL/TLS port 2465; use 2587 with STARTTLS only if 2465 fails. Enter the API key through a non-echoing secure prompt or the BillionMail secret UI. Run a no-content-leak SMTP AUTH test and confirm Postfix reports relay authentication success.

- [ ] **Step 7: Stop at the infrastructure gate if any prerequisite fails**

Required green gates: authoritative A/MX/SPF/DKIM/DMARC, Resend domain verified, trusted TLS hostname, mailbox SMTP AUTH, and relay AUTH. Restore only the affected configuration backup if a service change fails; preserve all unrelated domains and mailboxes.

### Task 6: Update Supabase Auth and deploy the root application

**Files:**
- Operational change only; no repository files.

**Interfaces:**
- Produces: Supabase Auth and Next.js support notifications using `server@n8nworkflow.com` in production.
- Consumes: verified Task 5 SMTP endpoint, dedicated mailbox secret, Resend API key, and the immutable Task 4 commit SHA.

- [ ] **Step 1: Back up current production environment files**

Back up `/opt/n8nmcp-app/deploy/.env`, `/opt/n8nmcp-app/deploy/.env.app`, and the active self-hosted Supabase `.env` to root-readable timestamped files. Confirm mode 0600 and read-back before editing.

- [ ] **Step 2: Update Supabase Auth securely**

Set the active Supabase environment to:

```dotenv
GOTRUE_SMTP_HOST=server.n8nworkflow.com
GOTRUE_SMTP_PORT=465
GOTRUE_SMTP_USER=server@n8nworkflow.com
GOTRUE_SMTP_ADMIN_EMAIL=server@n8nworkflow.com
GOTRUE_SMTP_SENDER_NAME=n8nworkflow
```

Enter the dedicated mailbox password only in the protected environment editor. Validate the Supabase Compose rendering, recreate only the Auth service, and wait for its health check to return healthy. Restore the Supabase environment backup and recreate Auth if health does not recover.

- [ ] **Step 3: Update the Next.js production runtime securely**

Set `/opt/n8nmcp-app/deploy/.env` and `.env.app` to:

```dotenv
NEXT_PUBLIC_SECURITY_EMAIL=server@n8nworkflow.com
SUPPORT_EMAIL_FROM=server@n8nworkflow.com
```

Confirm `RESEND_API_KEY` remains present without printing its value. Validate:

```bash
cd /opt/n8nmcp-app
docker compose -f deploy/docker-compose.aapanel.yml --env-file deploy/.env config --quiet
```

Expected: exit 0 with no missing required variables.

- [ ] **Step 4: Deploy the verified root Next.js commit**

Update `/opt/n8nmcp-app` to the immutable Task 4 commit without cleaning unrelated server paths, build the root standalone image through `deploy/docker-compose.aapanel.yml`, and recreate only `n8nmcp-app`. Do not rebuild or restart the Knowledge MCP container unless Compose proves it is required for dependency health.

- [ ] **Step 5: Verify service health immediately**

Run the active Compose status check and verify:

```bash
curl -fsS https://mcp.n8nworkflow.com/ >/dev/null
curl -fsS https://docs.n8nworkflow.com/ >/dev/null
curl -fsS https://blog.n8nworkflow.com/ >/dev/null
curl -fsS https://dashboard.n8nworkflow.com/ >/dev/null
```

Expected: all commands exit 0, app and Supabase Auth are healthy, and unrelated containers retain their pre-deploy IDs and restart counts.

### Task 7: Prove external delivery and complete acceptance

**Files:**
- Operational verification only; no repository files.

**Interfaces:**
- Produces: fresh production evidence for Auth mail, login, support mail, sender authentication, and rollback readiness.
- Consumes: a disposable Gmail plus-address controlled by the user and the deployed services from Task 6.

- [ ] **Step 1: Verify Supabase Auth delivery end to end**

Register a disposable Gmail plus-address through the production signup flow. Confirm the registration request returns success, then track the Postfix queue entry until it becomes `sent`, not merely queued. Confirm the message reaches Gmail, From is `server@n8nworkflow.com`, and Gmail reports SPF, DKIM, and DMARC as PASS.

- [ ] **Step 2: Verify confirmation and login**

Open the production confirmation link, confirm the user becomes verified, then sign in with the newly confirmed account and verify the dashboard session loads successfully.

- [ ] **Step 3: Verify support-notification delivery**

Create a production support ticket from the disposable account, run or await the protected outbox worker, and confirm the support acknowledgement reaches Gmail with From `server@n8nworkflow.com`, the expected ticket idempotency behavior, and SPF/DKIM/DMARC PASS.

- [ ] **Step 4: Re-run health and queue checks**

Confirm the app, Supabase Auth, BillionMail mail services, and relay remain healthy; confirm there are no deferred test messages and no repeated support outbox delivery for the same idempotency key.

- [ ] **Step 5: Clean up disposable test state**

Delete only the disposable test user, its test ticket/attachments where supported by the existing cleanup contract, and any test-only queued message. Do not delete production mail domains, the dedicated mailbox, or unrelated data.

- [ ] **Step 6: Produce the final evidence report**

Report the immutable app commit, repository verification counts, DNS/TLS status, service health, external Auth and support delivery results, SPF/DKIM/DMARC results, cleanup result, and the exact backup timestamps available for rollback. Redact all addresses used for disposable testing except the domain and never include secrets.
