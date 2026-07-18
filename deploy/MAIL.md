# Dedicated production mail

This runbook is the operator contract for the production sender
`server@n8nworkflow.com`. Complete every gate in order. Do not activate a
changed mail path until DNS, TLS, authentication, and external delivery checks
all pass.

## Scope and ownership

- Public SMTP hostname: `server.n8nworkflow.com`
- Production sender and login: `server@n8nworkflow.com`
- VPS: `159.195.40.97`
- Application directory: `/opt/n8nmcp-app`
- Mail runtime: the existing BillionMail installation on the VPS
- Outbound relay: Resend, configured through BillionMail

This file contains non-secret values only. Never put an SMTP password, Resend
credential, API key, DKIM private key, or provider recovery code in this
repository, a ticket, a command argument, or shell history.

## 1. Back up before changing anything

Open a change window and record the current DNS TTLs and mail-service health.
Export the current DNS zone from the DNS provider. Store that export in the
restricted operator vault, not in Git.

Select the installed roots and verify every source before creating a snapshot.
`SUPABASE_AUTH_SOURCE` must be the discovered directory containing the active
self-hosted Supabase Auth environment or compose configuration; do not guess it.
Run this whole block before changing DNS or any running service:

```bash
set -euo pipefail
BILLIONMAIL_ROOT=/opt/BillionMail
SUPABASE_AUTH_SOURCE=/path/to/discovered/supabase-auth
MAIL_BACKUP=/opt/n8nmcp-app/backups/mail/$(date -u +%Y%m%dT%H%M%SZ)

sudo test -d "$BILLIONMAIL_ROOT"
sudo test -r "$BILLIONMAIL_ROOT"
sudo find "$BILLIONMAIL_ROOT" -mindepth 1 -print -quit | grep -q .
sudo test -d "$SUPABASE_AUTH_SOURCE"
sudo test -r "$SUPABASE_AUTH_SOURCE"
sudo find "$SUPABASE_AUTH_SOURCE" -mindepth 1 -print -quit | grep -q .
sudo test -s /opt/n8nmcp-app/deploy/.env.app

sudo install -d -m 0700 -o root -g root "$MAIL_BACKUP"
sudo install -d -m 0700 -o root -g root "$MAIL_BACKUP/billionmail"
sudo install -d -m 0700 -o root -g root "$MAIL_BACKUP/supabase-auth"
sudo cp -a "$BILLIONMAIL_ROOT"/. "$MAIL_BACKUP/billionmail"/
sudo cp -a "$SUPABASE_AUTH_SOURCE"/. "$MAIL_BACKUP/supabase-auth"/
sudo cp -a /opt/n8nmcp-app/deploy/.env.app "$MAIL_BACKUP/app.env"
sudo chown -R root:root "$MAIL_BACKUP"
sudo chmod 0700 "$MAIL_BACKUP" "$MAIL_BACKUP/billionmail"
sudo find "$MAIL_BACKUP/supabase-auth" -type d -exec chmod 0700 {} +
sudo find "$MAIL_BACKUP/supabase-auth" -type f -exec chmod 0600 {} +
sudo chmod 0600 "$MAIL_BACKUP/app.env"

# Create root-only, deterministic manifests. Each command changes to its data
# root so the manifest records the same relative paths for source and backup.
sudo install -m 0600 -o root -g root /dev/null "$MAIL_BACKUP/billionmail.source.sha256"
sudo install -m 0600 -o root -g root /dev/null "$MAIL_BACKUP/billionmail.destination.sha256"
sudo install -m 0600 -o root -g root /dev/null "$MAIL_BACKUP/supabase-auth.source.sha256"
sudo install -m 0600 -o root -g root /dev/null "$MAIL_BACKUP/supabase-auth.destination.sha256"
sudo bash -c 'set -euo pipefail; cd -- "$1"; find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero' _ "$BILLIONMAIL_ROOT" \
  | sudo tee "$MAIL_BACKUP/billionmail.source.sha256" >/dev/null
sudo bash -c 'set -euo pipefail; cd -- "$1"; find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero' _ "$MAIL_BACKUP/billionmail" \
  | sudo tee "$MAIL_BACKUP/billionmail.destination.sha256" >/dev/null
sudo bash -c 'set -euo pipefail; cd -- "$1"; find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero' _ "$SUPABASE_AUTH_SOURCE" \
  | sudo tee "$MAIL_BACKUP/supabase-auth.source.sha256" >/dev/null
sudo bash -c 'set -euo pipefail; cd -- "$1"; find . -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum --zero' _ "$MAIL_BACKUP/supabase-auth" \
  | sudo tee "$MAIL_BACKUP/supabase-auth.destination.sha256" >/dev/null

# Fail-closed read-back and integrity gate.
sudo test -r "$MAIL_BACKUP/billionmail"
sudo find "$MAIL_BACKUP/billionmail" -mindepth 1 -print -quit | grep -q .
sudo tar -C "$MAIL_BACKUP/billionmail" -cf /dev/null .
sudo test -r "$MAIL_BACKUP/supabase-auth"
sudo find "$MAIL_BACKUP/supabase-auth" -mindepth 1 -print -quit | grep -q .
sudo tar -C "$MAIL_BACKUP/supabase-auth" -cf /dev/null .
sudo test -s "$MAIL_BACKUP/app.env"
sudo sha256sum "$MAIL_BACKUP/app.env"
sudo cmp -s "$MAIL_BACKUP/billionmail.source.sha256" "$MAIL_BACKUP/billionmail.destination.sha256" \
  || { echo "BillionMail backup manifest mismatch" >&2; exit 1; }
sudo cmp -s "$MAIL_BACKUP/supabase-auth.source.sha256" "$MAIL_BACKUP/supabase-auth.destination.sha256" \
  || { echo "Supabase Auth backup manifest mismatch" >&2; exit 1; }
sudo cmp -s /opt/n8nmcp-app/deploy/.env.app "$MAIL_BACKUP/app.env" \
  || { echo "App environment backup mismatch" >&2; exit 1; }
sudo test "$(sudo stat -c '%U:%G:%a' "$MAIL_BACKUP")" = "root:root:700"
sudo test "$(sudo stat -c '%U:%G:%a' "$MAIL_BACKUP/billionmail")" = "root:root:700"
sudo test "$(sudo stat -c '%U:%G:%a' "$MAIL_BACKUP/supabase-auth")" = "root:root:700"
sudo test "$(sudo stat -c '%U:%G:%a' "$MAIL_BACKUP/app.env")" = "root:root:600"
if sudo find "$MAIL_BACKUP/supabase-auth" -type d ! -perm 0700 -print -quit | grep -q .; then exit 1; fi
if sudo find "$MAIL_BACKUP/supabase-auth" -type f ! -perm 0600 -print -quit | grep -q .; then exit 1; fi
OWNERSHIP_MISMATCH="$(sudo find "$MAIL_BACKUP" \( ! -user root -o ! -group root \) -print -quit)"
if ! test -z "$OWNERSHIP_MISMATCH"; then
  unset OWNERSHIP_MISMATCH
  echo "Backup ownership verification failed" >&2
  exit 1
fi
unset OWNERSHIP_MISMATCH
```

If the installed BillionMail runtime reports a different root directory, use
that discovered directory in place of `/opt/BillionMail` and record it in the
change log. The backup root and Supabase backup directories must have mode `0700`;
every contained Supabase backup file and the app environment backup must have mode `0600`.
The SHA-256 manifests use relative paths, null-delimited filenames, and stable
byte-order sorting. Their silent comparisons prove that both copied trees have
the same regular files and content as their sources; the app `cmp -s` proves its
copy is byte-for-byte identical. No manifest or comparison prints file contents
or secrets. The `tar` commands are additional deliberate read-back checks: they must
traverse every copied entry without an unreadable-file or structural error.
Record the app-environment checksum, snapshot directory, and DNS export
identifier in the restricted change log. The resulting protected backups
contain secrets: never copy them into the repository or an unencrypted shared
location.

Stop before any DNS or runtime mutation if any backup verification fails. Do
not bypass a failed source, copy, ownership, permission, non-empty, read-back,
archive traversal, checksum, or DNS-export check; repair the backup and rerun
the entire gate first.

## 2. Publish and verify DNS

The initial routing set is exactly:

```txt
server.n8nworkflow.com.  A    159.195.40.97   DNS only
n8nworkflow.com.         MX   10 server.n8nworkflow.com.
```

Keep the SMTP host **DNS only**; do not proxy it through Cloudflare. In the
verified Resend and BillionMail domain screens, obtain the required SPF, DKIM,
and DMARC records. Copy every record name, type, and value verbatim. Never guess
a value or merge multiple provider values by hand. Where multiple senders need
one SPF policy, use only a provider-documented combined value confirmed by both
domain screens.

After authoritative DNS has propagated, verify it from outside the VPS:

```bash
dig +short A server.n8nworkflow.com
dig +short MX n8nworkflow.com
dig +short TXT n8nworkflow.com
dig +short TXT _dmarc.n8nworkflow.com
```

The A lookup must return only `159.195.40.97`, the MX lookup must identify
`10 server.n8nworkflow.com.`, and the TXT responses must exactly match the
verified provider screens. Query each DKIM selector shown by those screens with
`dig +short TXT <selector>._domainkey.n8nworkflow.com`.

## 3. Configure BillionMail and TLS

Configure the public submission endpoint with these non-secret values:

```dotenv
SMTP_PORT=465
SMTP_ADMIN_EMAIL=server@n8nworkflow.com
```

Port 465 must use implicit TLS and present a publicly trusted certificate for
`server.n8nworkflow.com`. Use port 587 with STARTTLS only as a documented
fallback for a client that cannot use 465; do not silently downgrade to
plaintext or accept an invalid certificate.

Configure BillionMail's authenticated outbound relay to Resend using port
`2465` for implicit TLS or port `2587` for STARTTLS. Copy the relay hostname,
username, and password from the verified Resend SMTP screen. Prefer 2465; use
2587 only when the runtime requires STARTTLS. Do not confuse the Resend relay
port with the public BillionMail submission port `465`.

Enter secrets only in BillionMail's protected UI or a root-only file opened
with `sudoedit`. If an approved setup tool requires interactive input, use a
hidden prompt (`read -rsp`), pass the value through standard input, and `unset`
it immediately. Do not use `echo`, command-line password flags, or paste a
secret into a command.

Verify the listener and certificate from a host outside the VPS:

```bash
openssl s_client -connect server.n8nworkflow.com:465 \
  -servername server.n8nworkflow.com -verify_return_error </dev/null
```

The command must complete certificate verification, show the expected hostname,
and negotiate TLS without exposing credentials. Confirm the firewall exposes
only the intended SMTP ports and that BillionMail accepts authenticated
submission but rejects unauthenticated relay.

## 4. Configure Supabase Auth

In the self-hosted Supabase Auth environment, set these exact non-secret values:

```dotenv
GOTRUE_SMTP_HOST=server.n8nworkflow.com
GOTRUE_SMTP_PORT=465
GOTRUE_SMTP_USER=server@n8nworkflow.com
GOTRUE_SMTP_ADMIN_EMAIL=server@n8nworkflow.com
GOTRUE_SMTP_SENDER_NAME=n8nworkflow
```

Set the corresponding SMTP password through the protected environment file or
secret manager; it is intentionally absent here. Require implicit TLS for port 465. Keep production activation blocked while changing Auth. The installer below
enables external email and sign-up only so the controlled existing-user and
new-user acceptance checks can exercise both Auth template paths.

### Install the versioned OTP-only Auth template

After the SMTP settings above are healthy, install the repository-owned OTP
template from the application checkout. The installer accepts only an absolute,
resolved Supabase root, makes a root-only timestamped backup, validates the
three-file Compose model, and recreates only `auth-email-templates` and `auth`.
Run this exact command:

```bash
sudo bash /opt/n8nmcp-app/deploy/supabase/install-email-otp-aapanel.sh /opt/n8nmcp-supabase
```

Keep the reported `BACKUP_PATH` in the restricted change log. Before recreating
Auth, the installer waits for the private template service healthcheck, fetches
the template over HTTP inside that container, and compares both its bytes and
SHA-256 digest with the versioned source. It rolls back automatically if backup
validation, Compose validation, template readiness/content, service recreation,
Auth health, or either configured template URL/OTP-length check fails. The
installer does not explicitly read or print the Supabase `.env` contents;
Compose automatically uses `.env` for interpolation while it builds the
effective model.

Confirm Auth health without dumping its environment:

```bash
sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' supabase-auth
```

The only acceptable result is `healthy`. Confirm both exact template settings
and the six-digit OTP length without printing any other environment values:

```bash
sudo docker inspect --format '{{range .Config.Env}}{{if eq . "GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=http://auth-email-templates/magic-link-otp.html"}}{{println "magic-link"}}{{end}}{{if eq . "GOTRUE_MAILER_TEMPLATES_CONFIRMATION=http://auth-email-templates/magic-link-otp.html"}}{{println "confirmation"}}{{end}}{{if eq . "GOTRUE_MAILER_OTP_LENGTH=6"}}{{println "otp-length"}}{{end}}{{end}}' supabase-auth
```

The output must contain exactly `magic-link`, `confirmation`, and `otp-length`,
one per line.

#### Controlled real-mail acceptance test

Use dedicated external test mailboxes and private browser sessions for these two
separate gates:

1. **Existing user:** use the production UI to request an OTP for an
   already-confirmed test account. The UI still sends `shouldCreateUser: true`,
   but Supabase recognizes the existing account and exercises the magic-link template.
   Confirm the message comes from `server@n8nworkflow.com`, contains exactly a six-digit
   verification code, and contains no sign-in link, URL, form action, or tracking
   image. Enter it only into the production verification form, end the resulting
   session, then submit the same code again in a fresh private session. The replay
   must be rejected.
2. **New user:** use the same production UI to request an OTP for a
   never-registered address. The production client sends `shouldCreateUser: true`
   and exercises the confirmation template. Apply the same code-only/content checks,
   verify that the first submission creates and confirms only the intended test
   user, then submit the same code again from a fresh private session. The replay
   must be rejected.

For both gates, request another code and confirm it expires according to the
configured Auth policy. A pass for one user state does not substitute for the
other.

Record only the test time, recipient domain, provider message ID, and pass/fail
result. The operator must never paste a real OTP into logs, shell commands,
screenshots, chat, or issue trackers. A delivered link, successful OTP replay,
unexpected sender, or provider/auth warning blocks activation.

#### Independent OTP template rollback

Template rollback is independent of database, BillionMail, DNS, and app-image
rollback. Use the exact `BACKUP_PATH` emitted by the installer; never guess a
backup directory. Stop Auth first, then stop and remove the template service; recreate only the two affected services. Restore the prior files (or their
recorded absence), validate the restored Compose model, and keep Auth stopped
until any restored template service is ready. The protected prior-state metadata
also makes this block a half-install rescue: it binds the old Auth container in a
pre-recreate failure and the replacement Auth container in a post-recreate failure.

```bash
set -euo pipefail
SUPABASE_ROOT=/opt/n8nmcp-supabase
BACKUP_DIR=/opt/n8nmcp-supabase/backups/email-otp/YYYYMMDDTHHMMSSZ_FROM_INSTALLER
BACKUP_VALIDATOR="$BACKUP_DIR/validate-email-otp-template.sh"
BACKUP_VALIDATOR_SHA256="$BACKUP_DIR/validate-email-otp-template.sh.sha256"
PRIOR_AUTH_STATE="$BACKUP_DIR/auth-prior-state.metadata"

sudo test "$(sudo realpath -e -- "$BACKUP_DIR")" = "$BACKUP_DIR"
sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_DIR")" = "root:root:700"
sudo test -f "$BACKUP_VALIDATOR"
sudo test ! -L "$BACKUP_VALIDATOR"
sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_VALIDATOR")" = "root:root:600"
sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_VALIDATOR_SHA256")" = "root:root:600"
EXPECTED_VALIDATOR_HASH="$(sudo cat "$BACKUP_VALIDATOR_SHA256")"
[[ "$EXPECTED_VALIDATOR_HASH" =~ ^[a-f0-9]{64}$ ]]
test "$(sudo sha256sum "$BACKUP_VALIDATOR" | awk '{print $1}')" = "$EXPECTED_VALIDATOR_HASH"
sudo test -f "$PRIOR_AUTH_STATE"
sudo test ! -L "$PRIOR_AUTH_STATE"
sudo test "$(sudo stat -c '%U:%G:%a' -- "$PRIOR_AUTH_STATE")" = "root:root:600"
mapfile -t PRIOR_STATE_LINES < <(sudo cat "$PRIOR_AUTH_STATE")
test "${#PRIOR_STATE_LINES[@]}" = 7
test "${PRIOR_STATE_LINES[0]}" = version=1
PRIOR_AUTH_MODEL="${PRIOR_STATE_LINES[1]#model=}"
PRIOR_AUTH_CONTAINER_ID="${PRIOR_STATE_LINES[2]#container_id=}"
PRIOR_AUTH_PROJECT="${PRIOR_STATE_LINES[3]#project=}"
PRIOR_AUTH_ROOT="${PRIOR_STATE_LINES[4]#root=}"
PRIOR_AUTH_SERVICE="${PRIOR_STATE_LINES[5]#service=}"
PRIOR_AUTH_CONFIG_FILES="${PRIOR_STATE_LINES[6]#config_files=}"
test "${PRIOR_STATE_LINES[1]}" = "model=$PRIOR_AUTH_MODEL"
test "${PRIOR_STATE_LINES[2]}" = "container_id=$PRIOR_AUTH_CONTAINER_ID"
test "${PRIOR_STATE_LINES[3]}" = "project=$PRIOR_AUTH_PROJECT"
test "${PRIOR_STATE_LINES[4]}" = "root=$PRIOR_AUTH_ROOT"
test "${PRIOR_STATE_LINES[5]}" = "service=$PRIOR_AUTH_SERVICE"
test "${PRIOR_STATE_LINES[6]}" = "config_files=$PRIOR_AUTH_CONFIG_FILES"
[[ "$PRIOR_AUTH_CONTAINER_ID" =~ ^[a-f0-9]{64}$ ]]
[[ "$PRIOR_AUTH_PROJECT" =~ ^[A-Za-z0-9_.-]+$ ]]
test "$PRIOR_AUTH_ROOT" = "$SUPABASE_ROOT"
test "$PRIOR_AUTH_SERVICE" = auth
cd -- "$SUPABASE_ROOT"

# Validate the complete backup state before stopping or changing any service.
TEMPLATE_WAS_PRESENT=0
if sudo test -f "$BACKUP_DIR/magic-link-otp.html"; then
  sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_DIR/magic-link-otp.html")" = "root:root:600"
  sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_DIR/template.metadata")" = "root:root:600"
  sudo test ! -e "$BACKUP_DIR/template.absent"
  read -r TEMPLATE_MODE TEMPLATE_UID TEMPLATE_GID < <(sudo cat "$BACKUP_DIR/template.metadata")
  [[ "$TEMPLATE_MODE $TEMPLATE_UID $TEMPLATE_GID" =~ ^[0-7]{3,4}[[:space:]][0-9]+[[:space:]][0-9]+$ ]]
  TEMPLATE_WAS_PRESENT=1
elif sudo test -f "$BACKUP_DIR/template.absent"; then
  sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_DIR/template.absent")" = "root:root:600"
  sudo test ! -e "$BACKUP_DIR/magic-link-otp.html"
  sudo test ! -e "$BACKUP_DIR/template.metadata"
else
  echo "Template backup state is incomplete" >&2
  exit 1
fi

OVERRIDE_WAS_PRESENT=0
if sudo test -f "$BACKUP_DIR/docker-compose.email-otp.yml"; then
  sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_DIR/docker-compose.email-otp.yml")" = "root:root:600"
  sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_DIR/override.metadata")" = "root:root:600"
  sudo test ! -e "$BACKUP_DIR/override.absent"
  read -r OVERRIDE_MODE OVERRIDE_UID OVERRIDE_GID < <(sudo cat "$BACKUP_DIR/override.metadata")
  [[ "$OVERRIDE_MODE $OVERRIDE_UID $OVERRIDE_GID" =~ ^[0-7]{3,4}[[:space:]][0-9]+[[:space:]][0-9]+$ ]]
  OVERRIDE_WAS_PRESENT=1
elif sudo test -f "$BACKUP_DIR/override.absent"; then
  sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_DIR/override.absent")" = "root:root:600"
  sudo test ! -e "$BACKUP_DIR/docker-compose.email-otp.yml"
  sudo test ! -e "$BACKUP_DIR/override.metadata"
else
  echo "Override backup state is incomplete" >&2
  exit 1
fi

if test "$PRIOR_AUTH_MODEL" = base-aapanel; then
  test "$OVERRIDE_WAS_PRESENT" = 0
  test "$PRIOR_AUTH_CONFIG_FILES" = "$SUPABASE_ROOT/docker-compose.yml,$SUPABASE_ROOT/overrides/docker-compose.aapanel.yml"
elif test "$PRIOR_AUTH_MODEL" = base-aapanel-email-otp; then
  test "$OVERRIDE_WAS_PRESENT" = 1
  test "$PRIOR_AUTH_CONFIG_FILES" = "$SUPABASE_ROOT/docker-compose.yml,$SUPABASE_ROOT/overrides/docker-compose.aapanel.yml,$SUPABASE_ROOT/overrides/docker-compose.email-otp.yml"
else
  echo "Prior Auth model is invalid" >&2
  exit 1
fi

# Mutation starts only after every backup ownership, mode, state, metadata, and
# validator-integrity gate above has passed. Bind either the exact prior Auth
# container/model or an exact replacement three-file Auth before any mutation.
SUPABASE_PROJECT="$PRIOR_AUTH_PROJECT"
LIVE_PRIOR_AUTH_ID="$(sudo docker inspect --format '{{.Id}}' "$PRIOR_AUTH_CONTAINER_ID" 2>/dev/null || true)"
NAMED_AUTH_CONTAINER_ID="$(sudo docker inspect --format '{{.Id}}' supabase-auth 2>/dev/null || true)"
if test "$LIVE_PRIOR_AUTH_ID" = "$PRIOR_AUTH_CONTAINER_ID"; then
  test "$NAMED_AUTH_CONTAINER_ID" = "$PRIOR_AUTH_CONTAINER_ID"
  if test "$PRIOR_AUTH_MODEL" = base-aapanel; then
    current=(sudo docker compose --project-name "$SUPABASE_PROJECT" -f docker-compose.yml -f overrides/docker-compose.aapanel.yml)
  else
    current=(sudo docker compose --project-name "$SUPABASE_PROJECT" -f docker-compose.yml -f overrides/docker-compose.aapanel.yml -f overrides/docker-compose.email-otp.yml)
  fi
  IFS=',' read -r -a EXPECTED_CURRENT_CONFIG_FILES <<<"$PRIOR_AUTH_CONFIG_FILES"
  echo "Detected half-installed pre-recreate state; binding the exact prior Auth container." >&2
elif test -n "$NAMED_AUTH_CONTAINER_ID" && test "$NAMED_AUTH_CONTAINER_ID" != "$PRIOR_AUTH_CONTAINER_ID"; then
  current=(sudo docker compose --project-name "$SUPABASE_PROJECT" -f docker-compose.yml -f overrides/docker-compose.aapanel.yml -f overrides/docker-compose.email-otp.yml)
  EXPECTED_CURRENT_CONFIG_FILES=("$SUPABASE_ROOT/docker-compose.yml" "$SUPABASE_ROOT/overrides/docker-compose.aapanel.yml" "$SUPABASE_ROOT/overrides/docker-compose.email-otp.yml")
  echo "Detected half-installed post-recreate state; binding the exact replacement Auth container." >&2
else
  echo "Auth container state is ambiguous; refusing manual rollback" >&2
  exit 1
fi
"${current[@]}" config --quiet
COMPOSE_AUTH_ID="$("${current[@]}" ps -q auth)"
AUTH_CONTAINER_ID="$NAMED_AUTH_CONTAINER_ID"
test -n "$COMPOSE_AUTH_ID"
test "$COMPOSE_AUTH_ID" = "$AUTH_CONTAINER_ID"
test "$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$AUTH_CONTAINER_ID")" = "$SUPABASE_PROJECT"
AUTH_WORKING_DIR="$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$AUTH_CONTAINER_ID")"
test "$(sudo realpath -e -- "$AUTH_WORKING_DIR")" = "$SUPABASE_ROOT"
test "$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$AUTH_CONTAINER_ID")" = auth
AUTH_CONFIG_FILES="$(sudo docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$AUTH_CONTAINER_ID")"
IFS=',' read -r -a ACTUAL_CONFIG_FILES <<<"$AUTH_CONFIG_FILES"
test "${#ACTUAL_CONFIG_FILES[@]}" = "${#EXPECTED_CURRENT_CONFIG_FILES[@]}"
for CONFIG_INDEX in "${!EXPECTED_CURRENT_CONFIG_FILES[@]}"; do
  test "$(sudo realpath -e -- "${ACTUAL_CONFIG_FILES[$CONFIG_INDEX]}")" = "${EXPECTED_CURRENT_CONFIG_FILES[$CONFIG_INDEX]}"
done
sudo docker stop "$AUTH_CONTAINER_ID"
test "$(sudo docker inspect --format '{{.State.Running}}' "$AUTH_CONTAINER_ID")" = false
mapfile -t TEMPLATE_IDS < <(sudo docker ps -aq \
  --filter "label=com.docker.compose.project=$SUPABASE_PROJECT" \
  --filter "label=com.docker.compose.service=auth-email-templates")
for TEMPLATE_ID in "${TEMPLATE_IDS[@]}"; do
  sudo docker rm -f "$TEMPLATE_ID" >/dev/null
done

if test "$TEMPLATE_WAS_PRESENT" = 1; then
  sudo install -m "$TEMPLATE_MODE" -o "$TEMPLATE_UID" -g "$TEMPLATE_GID" -- "$BACKUP_DIR/magic-link-otp.html" templates/magic-link-otp.html
else
  sudo rm -f -- templates/magic-link-otp.html
fi
if test "$OVERRIDE_WAS_PRESENT" = 1; then
  sudo install -m "$OVERRIDE_MODE" -o "$OVERRIDE_UID" -g "$OVERRIDE_GID" -- "$BACKUP_DIR/docker-compose.email-otp.yml" overrides/docker-compose.email-otp.yml
else
  sudo rm -f -- overrides/docker-compose.email-otp.yml
fi

restored=(sudo docker compose --project-name "$SUPABASE_PROJECT" -f docker-compose.yml -f overrides/docker-compose.aapanel.yml)
if sudo test -f overrides/docker-compose.email-otp.yml; then
  restored+=(-f overrides/docker-compose.email-otp.yml)
fi
"${restored[@]}" config --quiet
REMOTE_OTP_ENABLED=0
if sudo test -f overrides/docker-compose.email-otp.yml \
  && sudo grep -Eq 'GOTRUE_MAILER_TEMPLATES_(MAGIC_LINK|CONFIRMATION)([[:space:]]*:|=)' overrides/docker-compose.email-otp.yml; then
  REMOTE_OTP_ENABLED=1
fi
TEMPLATE_SERVICE_PRESENT=0
if "${restored[@]}" config --services | grep -Fxq auth-email-templates; then
  TEMPLATE_SERVICE_PRESENT=1
fi

if test "$REMOTE_OTP_ENABLED" = 1; then
  test "$TEMPLATE_SERVICE_PRESENT" = 1
  sudo test "$(sudo stat -c '%U:%G:%a' -- "$BACKUP_DIR/validate-email-otp-template.sh.sha256")" = "root:root:600"
  test "$(sudo sha256sum "$BACKUP_VALIDATOR" | awk '{print $1}')" = "$EXPECTED_VALIDATOR_HASH"
  sudo bash "$BACKUP_VALIDATOR" templates/magic-link-otp.html
  "${restored[@]}" up -d --no-deps --force-recreate auth-email-templates
  SERVED_TEMPLATE="$(mktemp)"
  trap 'rm -f -- "$SERVED_TEMPLATE"' EXIT
  EXPECTED_HASH="$(sudo sha256sum templates/magic-link-otp.html | awk '{print $1}')"
  TEMPLATE_READY=0
  for ((attempt = 1; attempt <= 120; attempt++)); do
    if "${restored[@]}" exec -T auth-email-templates wget -q -O - http://127.0.0.1/magic-link-otp.html >"$SERVED_TEMPLATE" \
      && sudo cmp -s -- templates/magic-link-otp.html "$SERVED_TEMPLATE" \
      && SERVED_HASH="$(sha256sum "$SERVED_TEMPLATE" | awk '{print $1}')" \
      && test "$SERVED_HASH" = "$EXPECTED_HASH"; then
      TEMPLATE_READY=1
      break
    fi
    sleep 1
  done
  test "$TEMPLATE_READY" = 1
  rm -f -- "$SERVED_TEMPLATE"
  trap - EXIT
elif test "$TEMPLATE_SERVICE_PRESENT" = 1; then
  "${restored[@]}" up -d --no-deps --force-recreate auth-email-templates
  echo "restored state does not enable the managed remote OTP template; OTP safety was not asserted" >&2
else
  echo "restored state does not enable the managed remote OTP template; OTP safety was not asserted" >&2
fi
"${restored[@]}" up -d --no-deps --force-recreate auth
AUTH_CONTAINER_ID="$("${restored[@]}" ps -q auth)"
test -n "$AUTH_CONTAINER_ID"
test "$(sudo docker inspect --format '{{.Id}}' supabase-auth)" = "$AUTH_CONTAINER_ID"
AUTH_STATUS=""
for ((attempt = 1; attempt <= 120; attempt++)); do
  AUTH_STATUS="$(sudo docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$AUTH_CONTAINER_ID" 2>/dev/null || true)"
  if test "$AUTH_STATUS" = healthy; then
    break
  fi
  sleep 1
done
test "$AUTH_STATUS" = healthy
```

The block exits non-zero before starting anything if restored Compose validation
fails. If the restored override enables a managed remote OTP template, the
strict action validator, template-service presence, HTTP fetch, byte comparison,
and SHA-256 comparison must all pass before Auth starts. A fully absent legacy
override/template state is restored without claiming OTP safety. Auth then has
up to 120 seconds to become healthy. Any failed gate keeps production activation
blocked. Do not roll back the database or restart the full Supabase stack for
this template-only change.

## 5. Configure the app runtime

In `/opt/n8nmcp-app/deploy/.env.app`, retain the pinned public and support sender
identity:

```dotenv
NEXT_PUBLIC_SECURITY_EMAIL=server@n8nworkflow.com
SUPPORT_EMAIL_FROM=server@n8nworkflow.com
```

If app notifications continue to use the Resend API directly, enter
`RESEND_API_KEY` only through the root-only environment file or deployment
secret mechanism. Restart only the app container after changing its environment
and confirm its health before testing mail. Do not print the effective
environment or include it in diagnostic bundles.

## 6. Acceptance gate

Do not enable production traffic until all of these checks pass:

1. The external DNS checks return the exact A and MX routing above, and the
   Resend/BillionMail screens show SPF, DKIM, and DMARC as verified.
2. The external OpenSSL check validates the certificate and hostname on port
   465 with no verification error.
3. An authenticated submission through BillionMail reaches an external Gmail address
   outside the organization. In Gmail, open **Show original** and confirm the
   visible From address is `server@n8nworkflow.com`, SPF is PASS, DKIM is PASS,
   DMARC is PASS, and the message is not an open-relay artifact.
   Resend logs must prove that the direct BillionMail submission used the intended relay and port (2465 or 2587).
4. Trigger a Supabase Auth OTP message and an app support notification to an
   external Gmail mailbox. For Auth, confirm the code-only content and reject
   any message containing a link or URL. For the app notification, confirm its
   expected links and reply behavior. Confirm delivery, sender display, and
   provider logs for both messages, checking both inbox and spam.
5. Send a reply from Gmail and confirm the operational mailbox receives it.
   Confirm expected bounces are visible to operators and no secret appears in
   application, Supabase Auth, BillionMail, or shell logs.

Record timestamps, recipient domain, message IDs, and pass/fail results in the
change log. Do not record message bodies, credentials, or authentication tokens.
Warnings or partial provider verification block activation.

## Rollback

Rollback is service-specific. Restore only the component changed, then repeat
its health and external acceptance checks:

- **DNS:** restore the provider's pre-change zone export, including its prior
  TTLs. Wait for authoritative answers to converge and verify A, MX, SPF, DKIM,
  and DMARC again.
- **BillionMail/TLS/relay:** stop only the BillionMail runtime, restore its
  protected snapshot from
  `/opt/n8nmcp-app/backups/mail/<UTC timestamp>/billionmail`, start it, and
  verify TLS plus authenticated submission. If only the Resend relay changed,
  restore the previous relay configuration instead of replacing unrelated mail
  state.
- **Supabase Auth:** restore the backed-up Auth environment from
  `/opt/n8nmcp-app/backups/mail/<UTC timestamp>/supabase-auth/` and restart only
  the Auth service. Do not roll back the database or the full Supabase stack for
  an SMTP configuration failure.
- **App:** restore
  `/opt/n8nmcp-app/backups/mail/<UTC timestamp>/app.env` to
  `/opt/n8nmcp-app/deploy/.env.app`, preserve mode `600`, and recreate only the
  app container. Do not roll back the application image unless the image itself
  caused the incident.

After rollback, revoke any relay credential that may have been exposed, confirm
the previous delivery path with an external Gmail check, and document the
restored snapshot and provider state. Keep production activation blocked until
all applicable gates are green.
