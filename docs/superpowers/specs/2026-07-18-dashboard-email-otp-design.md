# Dashboard email OTP login design

## Goal

Replace password login on `dashboard.n8nworkflow.com` with a six-digit email one-time password (OTP) flow backed by the existing self-hosted Supabase Auth service. A previously unseen email address may create a new account after successful OTP verification.

## Scope

- Change only the dashboard login experience and the self-hosted Auth email template/configuration needed to send numeric OTPs.
- Reuse the existing Supabase project, PostgreSQL database, browser client, session handling, and safe `next` redirect logic.
- Do not add another database, a custom OTP table, password fallback, magic links, or a separate registration page.

## Authentication flow

1. The login page initially displays an email field and **Send verification code** button.
2. The browser calls `supabase.auth.signInWithOtp` with the normalized email and `options.shouldCreateUser: true`.
3. Supabase Auth sends a six-digit code using the magic-link/OTP email template. The template contains `{{ .Token }}` and does not contain `{{ .ConfirmationURL }}` or another login link.
4. After a successful send, the page moves to the verification state, keeps the normalized email in component memory, and displays a six-slot numeric OTP input.
5. Submitting six digits calls `supabase.auth.verifyOtp({ email, token, type: "email" })`.
6. Successful verification establishes the normal Supabase browser session. The page navigates to the existing sanitized `next` destination, defaulting to `/dashboard`, and refreshes the router.

## User interface states

### Email entry

- Email input uses `type="email"` and `autoComplete="email"`.
- Submission trims and normalizes the email before sending.
- While sending, the email and submit controls are disabled.

### Code verification

- Shows the destination email so the user can confirm it.
- Uses the existing `InputOTP` component with exactly six numeric slots.
- Uses `autoComplete="one-time-code"` and rejects non-digit input.
- The verify button is disabled until all six digits are present or while a request is pending.
- **Change email** returns to the first step and clears the OTP and transient errors.
- **Resend code** is disabled for 60 seconds after each successful send. A successful resend resets the countdown and clears the OTP.

## Errors and privacy

- Display concise user-facing errors for invalid email, rate limiting, invalid or expired OTP, and network/service failure.
- Do not log, persist, send to Sentry, or place the OTP in URLs, query strings, local storage, or analytics.
- Preserve the current open-redirect protection for `next`.
- Rely on Supabase Auth for OTP generation, expiration, replay prevention, account creation, session issuance, and server-side request limits.
- Do not expose the service-role key; the browser continues to use only the configured publishable key.

## Self-hosted Supabase configuration

- Keep email signups enabled and `GOTRUE_DISABLE_SIGNUP=false` so `shouldCreateUser: true` can create accounts.
- Configure the Auth magic-link/OTP email template served to the self-hosted Auth container to render the six-digit `{{ .Token }}` value only, with no confirmation URL.
- Keep the existing production SMTP identity and TLS path.
- Restart only the Auth service when applying the template/configuration, then verify Auth health before changing the app.

## Testing

- Component tests verify the two-step state transition, normalized email, `shouldCreateUser: true`, six-digit validation, `type: "email"`, successful redirect, errors, change-email behavior, and resend cooldown.
- Contract tests verify that the password API and password field are absent from the login page.
- Deployment/configuration tests verify the self-hosted OTP template contains `{{ .Token }}` and excludes `{{ .ConfirmationURL }}`.
- Browser validation covers email entry, code-entry rendering after a successful mocked or controlled send, console health, and the unauthenticated dashboard redirect.
- Production acceptance sends a real OTP to an operator-controlled mailbox, verifies successful login and automatic account creation, and confirms that replaying the code fails.

## Rollback

- Keep the previous app image tag and the previous Supabase Auth configuration/template backup.
- If sending or verification fails, restore the prior Auth template/configuration and app image independently, restart only the affected service, and re-run health checks.
