# Dashboard Email OTP Login Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace dashboard password login with a six-digit Supabase email OTP flow that can automatically create new users.

**Architecture:** Keep authentication in the existing browser Supabase client. The login component becomes a two-state email/code form; Supabase Auth owns OTP generation, verification, account creation, replay prevention, and session issuance. A versioned self-hosted email template and installer configure the VPS Auth container to send `{{ .Token }}` without a magic link.

**Tech Stack:** Next.js 16 App Router, React 19, TypeScript, `@supabase/supabase-js`, `input-otp`, Vitest, self-hosted Supabase Auth, Docker Compose, aaPanel/VPS Docker.

## Global Constraints

- Allow automatic user creation with `options.shouldCreateUser: true`.
- Send and accept exactly six numeric digits; do not provide a password fallback or magic link.
- Keep the OTP only in React memory; never log, persist, add it to a URL, or send it to analytics/Sentry.
- Preserve `getSafeLoginDestination` and the existing Supabase session provider.
- Use the public Supabase publishable key in the browser; never expose the service-role key.
- Resend cooldown is exactly 60 seconds after every successful send.
- Production authority remains aaPanel/VPS Docker; keep independent Auth-template and app-image rollback points.

---

## File map

- Create `src/app/login/__tests__/page.test.tsx`: behavior tests for email send, OTP verification, errors, resend, and changing email.
- Modify `src/app/login/page.tsx`: two-state OTP login UI and client calls.
- Create `deploy/supabase/templates/magic-link-otp.html`: self-hosted Supabase Auth OTP-only email body.
- Create `deploy/supabase/docker-compose.email-otp.yml`: private template server plus Auth template URL override.
- Create `deploy/supabase/install-email-otp-aapanel.sh`: backup, install, validate, recreate Auth, health check, and rollback.
- Modify `src/lib/__tests__/dedicated-mail-domain.test.ts`: repository contract for OTP template and installer safety.
- Modify `deploy/MAIL.md`: operator acceptance and rollback instructions.

### Task 1: Two-step email OTP login

**Files:**
- Create: `src/app/login/__tests__/page.test.tsx`
- Modify: `src/app/login/page.tsx`

**Interfaces:**
- Consumes: `supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true } })` and `supabase.auth.verifyOtp({ email, token, type: "email" })`.
- Consumes: `getSafeLoginDestination(nextPath): string`.
- Produces: the existing default export `LoginPage`; no new public application API.

- [ ] **Step 1: Write the failing send-code tests**

Create `src/app/login/__tests__/page.test.tsx` with jsdom, mocked navigation/auth context, and mocked Supabase calls. The first tests must render the page, submit `" New.User@Example.com "`, and assert:

```ts
expect(signInWithOtp).toHaveBeenCalledWith({
  email: "new.user@example.com",
  options: { shouldCreateUser: true },
});
expect(host.textContent).toContain("Enter verification code");
expect(host.querySelector('input[type="password"]')).toBeNull();
```

Use React `act`, `createRoot`, and DOM `dispatchEvent` following the existing component-test pattern. Mock `@/components/auth-provider`, `next/navigation`, and `@/integrations/supabase/client`; never mock the component being tested.

- [ ] **Step 2: Run the send-code tests and confirm RED**

Run:

```powershell
npm test -- src/app/login/__tests__/page.test.tsx
```

Expected: FAIL because the current page renders a password field and calls `signInWithPassword`.

- [ ] **Step 3: Implement the minimal email-entry state**

In `src/app/login/page.tsx`, replace password state with:

```ts
type LoginStep = "email" | "code";
const [step, setStep] = useState<LoginStep>("email");
const [email, setEmail] = useState("");
const [submittedEmail, setSubmittedEmail] = useState("");
const [code, setCode] = useState("");
```

Normalize with `email.trim().toLowerCase()`. The email form calls:

```ts
const { error: sendError } = await supabase.auth.signInWithOtp({
  email: normalizedEmail,
  options: { shouldCreateUser: true },
});
```

On success, set `submittedEmail`, clear `code` and `error`, change to `"code"`, and start the cooldown. Remove the password input and every `signInWithPassword` reference.

- [ ] **Step 4: Write failing verification and navigation tests**

Extend the test to enter `123456`, submit, and assert:

```ts
expect(verifyOtp).toHaveBeenCalledWith({
  email: "new.user@example.com",
  token: "123456",
  type: "email",
});
expect(routerReplace).toHaveBeenCalledWith("/dashboard/support");
expect(routerRefresh).toHaveBeenCalledTimes(1);
```

Also assert non-digits are rejected, the verify button is disabled before six digits, and an invalid OTP leaves the code step visible with an alert.

- [ ] **Step 5: Run verification tests and confirm RED**

Run the same focused Vitest command. Expected: FAIL because code entry and `verifyOtp` are not implemented.

- [ ] **Step 6: Implement six-digit verification UI**

Import `REGEXP_ONLY_DIGITS` from `input-otp` and `InputOTP`, `InputOTPGroup`, `InputOTPSlot` from the existing UI component. Render exactly six slots:

```tsx
<InputOTP
  maxLength={6}
  pattern={REGEXP_ONLY_DIGITS}
  value={code}
  onChange={setCode}
  autoComplete="one-time-code"
  disabled={submitting}
>
  <InputOTPGroup>
    {Array.from({ length: 6 }, (_, index) => (
      <InputOTPSlot key={index} index={index} />
    ))}
  </InputOTPGroup>
</InputOTP>
```

Verify only when `/^\d{6}$/` passes. On success call `router.replace(destination)` and `router.refresh()`.

- [ ] **Step 7: Add resend and change-email tests**

Use fake timers. Assert resend is disabled for 60 seconds, becomes enabled at 60 seconds, calls `signInWithOtp` with the same payload, resets the code, and restarts the cooldown. Assert **Change email** restores the email form and clears the OTP/error.

- [ ] **Step 8: Implement cooldown and actions**

Use `resendSeconds` state and one `useEffect` interval active only when the value is positive. Successful sends set it to `60`; cleanup clears the interval. Render `Resend code in 60s` while disabled and `Resend code` when available.

- [ ] **Step 9: Verify Task 1 and commit**

Run:

```powershell
npm test -- src/app/login/__tests__/page.test.tsx src/lib/support/__tests__/auth-redirect.test.ts
npm run type-check
npm run lint
```

Expected: all commands exit 0. Commit:

```powershell
git add src/app/login/page.tsx src/app/login/__tests__/page.test.tsx
git commit -m "feat: replace dashboard password login with email OTP"
```

### Task 2: Version and validate the self-hosted OTP email template

**Files:**
- Create: `deploy/supabase/templates/magic-link-otp.html`
- Create: `deploy/supabase/docker-compose.email-otp.yml`
- Create: `deploy/supabase/install-email-otp-aapanel.sh`
- Modify: `src/lib/__tests__/dedicated-mail-domain.test.ts`
- Modify: `deploy/MAIL.md`

**Interfaces:**
- Produces: a template reachable inside the Supabase Docker network at `http://auth-email-templates/magic-link-otp.html`.
- Produces: `install-email-otp-aapanel.sh [SUPABASE_ROOT]`, defaulting to `/opt/n8nmcp-supabase`.
- Consumes: the existing self-hosted Supabase `auth` service and `.env`; it changes no database schema.

- [ ] **Step 1: Write failing deployment contract tests**

Extend `dedicated-mail-domain.test.ts` to require:

```ts
const otpTemplate = read("deploy/supabase/templates/magic-link-otp.html");
expect(otpTemplate).toContain("{{ .Token }}");
expect(otpTemplate).not.toContain(".ConfirmationURL");
expect(otpTemplate).not.toMatch(/href\s*=/i);

const otpCompose = read("deploy/supabase/docker-compose.email-otp.yml");
expect(otpCompose).toContain("GOTRUE_MAILER_TEMPLATES_MAGIC_LINK");
expect(otpCompose).toContain("http://auth-email-templates/magic-link-otp.html");

const installer = read("deploy/supabase/install-email-otp-aapanel.sh");
expect(installer).toContain("docker compose config --quiet");
expect(installer).toContain("docker inspect");
expect(installer).toContain("rollback");
```

- [ ] **Step 2: Run contract test and confirm RED**

Run `npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts`. Expected: FAIL because the three deployment artifacts do not exist.

- [ ] **Step 3: Add the OTP-only HTML template**

Create a complete minimal HTML email. Its authentication content must be:

```html
<p>Your n8n-mcp verification code is:</p>
<p style="font-size:32px;font-weight:700;letter-spacing:0.35em">{{ .Token }}</p>
<p>This code is single-use and expires automatically. If you did not request it, ignore this email.</p>
```

Do not include anchors, URLs, tracking pixels, or user-controlled template variables.

- [ ] **Step 4: Add the Compose override**

Create an override with a private `caddy:2.8-alpine` service named `auth-email-templates`, a read-only template mount, no published ports, and the existing Supabase default network. Extend `auth` with:

```yaml
depends_on:
  auth-email-templates:
    condition: service_started
environment:
  GOTRUE_DISABLE_SIGNUP: "false"
  GOTRUE_EXTERNAL_EMAIL_ENABLED: "true"
  GOTRUE_MAILER_TEMPLATES_MAGIC_LINK: http://auth-email-templates/magic-link-otp.html
  GOTRUE_MAILER_SUBJECTS_MAGIC_LINK: Your n8n-mcp verification code
```

- [ ] **Step 5: Add the fail-closed aaPanel installer**

The Bash script must:

1. Resolve and validate the exact Supabase root.
2. Confirm `docker-compose.yml`, `.env`, and the running `supabase-auth` container.
3. Create a timestamped root-only backup of any prior template and override.
4. Install the versioned template and override with non-world-writable modes.
5. Run `docker compose -f docker-compose.yml -f overrides/docker-compose.aapanel.yml -f overrides/docker-compose.email-otp.yml config --quiet`.
6. Recreate only `auth-email-templates` and `auth`.
7. Poll `supabase-auth` until healthy and verify the configured template URL without printing secrets.
8. On any failure, restore the backup, recreate only the affected services, verify rollback health, and exit non-zero.

- [ ] **Step 6: Document acceptance and rollback**

Update `deploy/MAIL.md` with the exact installer command, health command, a controlled real-mail acceptance test, OTP replay rejection check, and independent template rollback. State that the operator must never paste a real OTP into logs or issue trackers.

- [ ] **Step 7: Verify Task 2 and commit**

Run:

```powershell
npm test -- src/lib/__tests__/dedicated-mail-domain.test.ts
bash -n deploy/supabase/install-email-otp-aapanel.sh
docker compose -f deploy/supabase/docker-compose.email-otp.yml config --quiet
```

Expected: tests and syntax/config validation pass. Commit all Task 2 files with `git commit -m "feat: configure self-hosted Supabase email OTP"`.

### Task 3: Full verification, VPS rollout, and production acceptance

**Files:**
- No new source files.
- Deploy the commits produced by Tasks 1 and 2.

**Interfaces:**
- Consumes: versioned OTP template installer and app image.
- Produces: healthy `supabase-auth` and `n8nmcp-app` containers with the OTP login flow live at `https://dashboard.n8nworkflow.com/login`.

- [ ] **Step 1: Run repository gates**

Run `npm run lint`, `npm run type-check`, `npm test`, and `npm run build`. Expected: exit 0; record exact test counts and build routes.

- [ ] **Step 2: Push the feature branch and create rollback identifiers**

Push the current branch. On the VPS, record the current app Git SHA and tag `n8nmcp-app:local` as `rollback-<sha>-<UTC timestamp>`. Back up the current Supabase Auth override/template before mutation.

- [ ] **Step 3: Install and verify the Auth template first**

Copy or fetch the committed installer artifacts into `/opt/n8nmcp-app`, run the installer against `/opt/n8nmcp-supabase`, and require `supabase-auth` health before proceeding. If Auth does not become healthy, stop and let the installer roll back; do not deploy the app.

- [ ] **Step 4: Deploy only the app service**

Fast-forward `/opt/n8nmcp-app` to the verified commit. Run:

```bash
docker compose -f deploy/docker-compose.aapanel.yml \
  --env-file deploy/.env --env-file deploy/.env.app build app
docker compose -f deploy/docker-compose.aapanel.yml \
  --env-file deploy/.env --env-file deploy/.env.app up -d --no-deps app
```

Poll `n8nmcp-app` until healthy and inspect recent logs for startup/auth errors.

- [ ] **Step 5: Browser smoke test without transmitting a real OTP**

Verify dashboard redirects to `/login`, the password field is absent, email submission reaches the six-digit code state using an operator-approved test mailbox, resend is initially disabled, and there are no relevant console errors.

- [ ] **Step 6: Controlled production OTP acceptance**

With an operator-controlled previously unregistered mailbox, send a code, confirm the email contains six digits and no login link, enter the OTP, verify automatic account creation and dashboard access, sign out, and confirm replaying the same OTP fails. Do not record the OTP value.

- [ ] **Step 7: Merge and restore normal VPS branch**

After acceptance, fast-forward `main`, switch the VPS checkout back to `main`, verify its SHA matches remote `main`, and recheck `supabase-auth`, `n8nmcp-app`, docs, blog, and dashboard health.

- [ ] **Step 8: Final evidence**

Report commit SHA, app image ID, Auth/app health, test counts, browser results, acceptance outcome, rollback identifiers, and any untested external-mail state.
