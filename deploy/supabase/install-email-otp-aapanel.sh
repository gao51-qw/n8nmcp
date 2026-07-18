#!/usr/bin/env bash
set -Eeuo pipefail

readonly DEFAULT_SUPABASE_ROOT="/opt/n8nmcp-supabase"
readonly AUTH_CONTAINER="supabase-auth"

die() {
  printf 'ERROR: %s\n' "$1" >&2
  return 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || die "Required command is unavailable: $1"
}

validate_exact_file() {
  local path="$1"
  [[ -f "$path" && ! -L "$path" ]] || die "Required regular file is missing or is a symlink: $path"
  [[ "$(realpath -e -- "$path")" == "$path" ]] || die "File does not resolve to its exact expected path: $path"
}

validate_secure_directory() {
  local path="$1"
  local mode
  [[ -d "$path" && ! -L "$path" ]] || die "Required directory is missing or is a symlink: $path"
  [[ "$(realpath -e -- "$path")" == "$path" ]] || die "Directory does not resolve to its exact expected path: $path"
  [[ "$(stat -c '%u' -- "$path")" == "0" ]] || die "Directory must be owned by root: $path"
  mode="$(stat -c '%a' -- "$path")"
  (( (8#$mode & 8#022) == 0 )) || die "Directory must not be group- or world-writable: $path"
}

ensure_secure_directory() {
  local path="$1"
  local mode="$2"
  if [[ -e "$path" || -L "$path" ]]; then
    validate_secure_directory "$path"
  else
    install -d -m "$mode" -o root -g root -- "$path"
  fi
}

wait_for_auth_healthy() {
  local attempts="${1:-120}"
  local status=""
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$AUTH_CONTAINER" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    sleep 1
  done
  printf 'Auth did not become healthy (last status: %s).\n' "${status:-unavailable}" >&2
  return 1
}

verify_template_url() {
  local match
  match="$(docker inspect --format \
    '{{range .Config.Env}}{{if eq . "GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=http://auth-email-templates/magic-link-otp.html"}}{{println "configured"}}{{end}}{{end}}' \
    "$AUTH_CONTAINER")"
  [[ "$match" == "configured" ]] || {
    printf 'Auth does not contain the required OTP template URL.\n' >&2
    return 1
  }
}

if (( EUID != 0 )); then
  die "Run this installer as root."
fi
if (( $# > 1 )); then
  die "Usage: $0 [SUPABASE_ROOT]"
fi

for command_name in docker install realpath stat cmp date grep sleep rm; do
  require_command "$command_name"
done
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 is unavailable."

requested_root="${1:-$DEFAULT_SUPABASE_ROOT}"
[[ "$requested_root" == /* ]] || die "SUPABASE_ROOT must be an absolute path."
SUPABASE_ROOT="$(realpath -e -- "$requested_root")" || die "SUPABASE_ROOT does not exist."
[[ "$SUPABASE_ROOT" != "/" ]] || die "Refusing to use the filesystem root."
[[ "$SUPABASE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]] || die "SUPABASE_ROOT contains unsupported characters."
validate_secure_directory "$SUPABASE_ROOT"

readonly SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly SOURCE_TEMPLATE="$SCRIPT_DIR/templates/magic-link-otp.html"
readonly SOURCE_OVERRIDE="$SCRIPT_DIR/docker-compose.email-otp.yml"
readonly BASE_COMPOSE="$SUPABASE_ROOT/docker-compose.yml"
readonly AAPANEL_OVERRIDE="$SUPABASE_ROOT/overrides/docker-compose.aapanel.yml"
readonly TARGET_OVERRIDE="$SUPABASE_ROOT/overrides/docker-compose.email-otp.yml"
readonly TARGET_TEMPLATE="$SUPABASE_ROOT/templates/magic-link-otp.html"

validate_exact_file "$SOURCE_TEMPLATE"
validate_exact_file "$SOURCE_OVERRIDE"
validate_exact_file "$BASE_COMPOSE"
validate_exact_file "$SUPABASE_ROOT/.env"
validate_exact_file "$AAPANEL_OVERRIDE"

if [[ -e "$TARGET_OVERRIDE" || -L "$TARGET_OVERRIDE" ]]; then
  validate_exact_file "$TARGET_OVERRIDE"
fi
if [[ -e "$TARGET_TEMPLATE" || -L "$TARGET_TEMPLATE" ]]; then
  validate_exact_file "$TARGET_TEMPLATE"
fi

auth_running="$(docker inspect --format '{{.State.Running}}' "$AUTH_CONTAINER" 2>/dev/null || true)"
[[ "$auth_running" == "true" ]] || die "The $AUTH_CONTAINER container is not running."

cd -- "$SUPABASE_ROOT"
readonly -a BASE_COMPOSE_COMMAND=(
  docker compose
  -f docker-compose.yml
  -f overrides/docker-compose.aapanel.yml
)
readonly -a OTP_COMPOSE_COMMAND=(
  "${BASE_COMPOSE_COMMAND[@]}"
  -f overrides/docker-compose.email-otp.yml
)

"${BASE_COMPOSE_COMMAND[@]}" config --quiet

ensure_secure_directory "$SUPABASE_ROOT/backups" 0700
ensure_secure_directory "$SUPABASE_ROOT/backups/email-otp" 0700
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$SUPABASE_ROOT/backups/email-otp/$timestamp"
[[ ! -e "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || die "Backup path already exists: $BACKUP_DIR"
install -d -m 0700 -o root -g root -- "$BACKUP_DIR"

had_template=0
had_override=0
template_mode=0644
override_mode=0644

if [[ -f "$TARGET_TEMPLATE" ]]; then
  had_template=1
  template_mode="$(stat -c '%a' -- "$TARGET_TEMPLATE")"
  install -m 0600 -o root -g root -- "$TARGET_TEMPLATE" "$BACKUP_DIR/magic-link-otp.html"
  cmp -s -- "$TARGET_TEMPLATE" "$BACKUP_DIR/magic-link-otp.html" || die "Template backup verification failed."
else
  install -m 0600 -o root -g root /dev/null "$BACKUP_DIR/template.absent"
fi

if [[ -f "$TARGET_OVERRIDE" ]]; then
  had_override=1
  override_mode="$(stat -c '%a' -- "$TARGET_OVERRIDE")"
  install -m 0600 -o root -g root -- "$TARGET_OVERRIDE" "$BACKUP_DIR/docker-compose.email-otp.yml"
  cmp -s -- "$TARGET_OVERRIDE" "$BACKUP_DIR/docker-compose.email-otp.yml" || die "Override backup verification failed."
else
  install -m 0600 -o root -g root /dev/null "$BACKUP_DIR/override.absent"
fi

rollback() {
  local rollback_status=0
  local -a rollback_compose
  local -a rollback_services=(auth)

  printf 'Rolling back the email OTP deployment from %s.\n' "$BACKUP_DIR" >&2

  if [[ -f "$TARGET_OVERRIDE" ]]; then
    "${OTP_COMPOSE_COMMAND[@]}" stop auth-email-templates >/dev/null 2>&1 || true
    "${OTP_COMPOSE_COMMAND[@]}" rm -sf auth-email-templates >/dev/null 2>&1 || true
  fi

  if (( had_template )); then
    install -m "$template_mode" -o root -g root -- "$BACKUP_DIR/magic-link-otp.html" "$TARGET_TEMPLATE" || rollback_status=1
  else
    rm -f -- "$TARGET_TEMPLATE" || rollback_status=1
  fi
  if (( had_override )); then
    install -m "$override_mode" -o root -g root -- "$BACKUP_DIR/docker-compose.email-otp.yml" "$TARGET_OVERRIDE" || rollback_status=1
    rollback_compose=("${OTP_COMPOSE_COMMAND[@]}")
  else
    rm -f -- "$TARGET_OVERRIDE" || rollback_status=1
    rollback_compose=("${BASE_COMPOSE_COMMAND[@]}")
  fi

  if ! "${rollback_compose[@]}" config --quiet; then
    rollback_status=1
  elif (( had_override )) && "${rollback_compose[@]}" config --services | grep -Fxq auth-email-templates; then
    rollback_services=(auth-email-templates auth)
  fi

  if ! "${rollback_compose[@]}" up -d --no-deps --force-recreate "${rollback_services[@]}"; then
    rollback_status=1
  elif ! wait_for_auth_healthy 120; then
    rollback_status=1
  fi

  if (( rollback_status != 0 )); then
    printf 'Rollback verification failed; keep production activation blocked.\n' >&2
    return 1
  fi
  printf 'Rollback completed and Supabase Auth is healthy.\n' >&2
}

mutation_started=0
on_error() {
  local exit_code="$1"
  local line_number="$2"
  trap - ERR INT TERM
  set +e
  printf 'Installation failed at line %s.\n' "$line_number" >&2
  if (( mutation_started )); then
    rollback || true
  fi
  (( exit_code != 0 )) || exit_code=1
  exit "$exit_code"
}
trap 'on_error "$?" "$LINENO"' ERR
trap 'on_error 130 "$LINENO"' INT
trap 'on_error 143 "$LINENO"' TERM

mutation_started=1
ensure_secure_directory "$SUPABASE_ROOT/templates" 0755
ensure_secure_directory "$SUPABASE_ROOT/overrides" 0755
install -m 0644 -o root -g root -- "$SOURCE_TEMPLATE" "$TARGET_TEMPLATE"
install -m 0644 -o root -g root -- "$SOURCE_OVERRIDE" "$TARGET_OVERRIDE"

"${OTP_COMPOSE_COMMAND[@]}" config --quiet
"${OTP_COMPOSE_COMMAND[@]}" up -d --no-deps --force-recreate auth-email-templates auth
wait_for_auth_healthy 120
verify_template_url

template_container_id="$("${OTP_COMPOSE_COMMAND[@]}" ps -q auth-email-templates)"
[[ -n "$template_container_id" ]] || die "The auth-email-templates container was not created."
[[ "$(docker inspect --format '{{.State.Running}}' "$template_container_id")" == "true" ]] || die "The auth-email-templates container is not running."

mutation_started=0
trap - ERR INT TERM
printf 'Email OTP template installed successfully.\n'
printf 'BACKUP_PATH=%s\n' "$BACKUP_DIR"
