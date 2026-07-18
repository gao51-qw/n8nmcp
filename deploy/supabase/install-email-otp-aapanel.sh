#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

readonly DEFAULT_SUPABASE_ROOT="/opt/n8nmcp-supabase"
readonly AUTH_CONTAINER="supabase-auth"
readonly TEMPLATE_PATH="/magic-link-otp.html"

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

validate_root_file_mode() {
  local path="$1"
  local mode="$2"
  [[ -f "$path" && ! -L "$path" ]] || die "Backup file is missing or is a symlink: $path"
  [[ "$(stat -c '%U:%G:%a' -- "$path")" == "root:root:$mode" ]] || die "Backup file permissions are invalid: $path"
}

wait_for_auth_healthy() {
  local attempts="${1:-120}"
  local status=""
  local attempt
  for ((attempt = 1; attempt <= attempts; attempt++)); do
    status="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$AUTH_CONTAINER_ID" 2>/dev/null || true)"
    if [[ "$status" == "healthy" ]]; then
      return 0
    fi
    sleep 1
  done
  printf 'Auth did not become healthy (last status: %s).\n' "${status:-unavailable}" >&2
  return 1
}

ensure_auth_stopped() {
  local state_file="$BACKUP_DIR/auth-running.state"
  local actual_id=""
  local running=""

  if [[ -z "${AUTH_CONTAINER_ID:-}" ]]; then
    return 0
  fi
  actual_id="$(docker inspect --format '{{.Id}}' "$AUTH_CONTAINER_ID" 2>/dev/null || true)"
  [[ "$actual_id" == "$AUTH_CONTAINER_ID" ]] || return 1
  if ! docker inspect --format '{{.State.Running}}' "$AUTH_CONTAINER_ID" >"$state_file"; then
    return 1
  fi
  IFS= read -r running <"$state_file" || return 1
  if [[ "$running" == "true" ]]; then
    docker stop "$AUTH_CONTAINER_ID" >/dev/null || return 1
    if ! docker inspect --format '{{.State.Running}}' "$AUTH_CONTAINER_ID" >"$state_file"; then
      return 1
    fi
    IFS= read -r running <"$state_file" || return 1
  fi
  if [[ "$running" != "false" ]]; then
    return 1
  fi
  rm -f -- "$state_file"
}

bind_auth_container() {
  local expected_config_files="$1"
  shift
  local -a compose_command=("$@")
  local compose_auth_id=""
  local named_auth_id=""
  local auth_project=""
  local auth_working_dir=""
  local auth_config_files=""
  local auth_service=""
  local -a actual_files=()
  local -a expected_files=()
  local index

  compose_auth_id="$("${compose_command[@]}" ps -aq auth)" || return 1
  named_auth_id="$(docker inspect --format '{{.Id}}' "$AUTH_CONTAINER" 2>/dev/null || true)"
  [[ "$compose_auth_id" =~ ^[a-f0-9]{64}$ && "$named_auth_id" =~ ^[a-f0-9]{64}$ ]] || return 1
  [[ "$compose_auth_id" == "$named_auth_id" ]] || return 1

  auth_project="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$named_auth_id")" || return 1
  auth_working_dir="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$named_auth_id")" || return 1
  auth_config_files="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project.config_files"}}' "$named_auth_id")" || return 1
  auth_service="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.service"}}' "$named_auth_id")" || return 1

  [[ "$auth_project" == "$SUPABASE_COMPOSE_PROJECT" ]] || return 1
  auth_working_dir="$(realpath -e -- "$auth_working_dir")" || return 1
  [[ "$auth_working_dir" == "$SUPABASE_ROOT" ]] || return 1
  [[ "$auth_service" == "auth" ]] || return 1

  IFS=',' read -r -a actual_files <<<"$auth_config_files"
  IFS=',' read -r -a expected_files <<<"$expected_config_files"
  (( ${#actual_files[@]} == ${#expected_files[@]} )) || return 1
  for ((index = 0; index < ${#expected_files[@]}; index++)); do
    [[ "$(realpath -e -- "${actual_files[$index]}")" == "${expected_files[$index]}" ]] || return 1
  done

  AUTH_CONTAINER_ID="$named_auth_id"
}

verify_served_template() {
  local expected_template="$1"
  shift
  local -a compose_command=("$@")
  local served_template="$BACKUP_DIR/served-template.check"
  local expected_hash="$BACKUP_DIR/expected-template.sha256"
  local served_hash="$BACKUP_DIR/served-template.sha256"

  if ! "${compose_command[@]}" exec -T auth-email-templates \
    wget -q -O - "http://127.0.0.1${TEMPLATE_PATH}" >"$served_template"; then
    return 1
  fi
  if ! cmp -s -- "$expected_template" "$served_template"; then
    return 1
  fi
  sha256sum "$expected_template" | awk '{print $1}' >"$expected_hash"
  sha256sum "$served_template" | awk '{print $1}' >"$served_hash"
  if ! cmp -s -- "$expected_hash" "$served_hash"; then
    return 1
  fi
  rm -f -- "$served_template" "$expected_hash" "$served_hash"
}

wait_for_template_ready() {
  local expected_template="$1"
  local attempts="$2"
  local health_requirement="$3"
  shift 3
  local -a compose_command=("$@")
  local container_id=""
  local running=""
  local health=""
  local attempt
  local id_file="$BACKUP_DIR/template-container.id"
  local state_file="$BACKUP_DIR/template-container.state"

  for ((attempt = 1; attempt <= attempts; attempt++)); do
    : >"$id_file"
    if "${compose_command[@]}" ps -q auth-email-templates >"$id_file" 2>/dev/null; then
      IFS= read -r container_id <"$id_file" || true
      if [[ -n "$container_id" ]] && docker inspect --format \
        '{{.State.Running}} {{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' \
        "$container_id" >"$state_file" 2>/dev/null; then
        read -r running health <"$state_file" || true
        if [[ "$running" == "true" ]] && \
          { [[ "$health" == "healthy" ]] || [[ "$health_requirement" == "require-http-readiness" && "$health" == "missing" ]]; }; then
          if verify_served_template "$expected_template" "${compose_command[@]}"; then
            rm -f -- "$id_file" "$state_file"
            return 0
          fi
        fi
      fi
    fi
    sleep 1
  done
  rm -f -- "$id_file" "$state_file"
  printf 'Template service did not become ready with the exact versioned content.\n' >&2
  return 1
}

verify_auth_template_configuration() {
  local actual="$BACKUP_DIR/auth-template-configuration.check"
  if ! docker inspect --format \
    '{{range .Config.Env}}{{if eq . "GOTRUE_MAILER_TEMPLATES_MAGIC_LINK=http://auth-email-templates/magic-link-otp.html"}}{{println "magic-link"}}{{end}}{{if eq . "GOTRUE_MAILER_TEMPLATES_CONFIRMATION=http://auth-email-templates/magic-link-otp.html"}}{{println "confirmation"}}{{end}}{{if eq . "GOTRUE_MAILER_OTP_LENGTH=6"}}{{println "otp-length"}}{{end}}{{end}}' \
    "$AUTH_CONTAINER_ID" >"$actual"; then
    return 1
  fi
  grep -Fxq "magic-link" "$actual" && \
    grep -Fxq "confirmation" "$actual" && \
    grep -Fxq "otp-length" "$actual" && \
    [[ "$(wc -l <"$actual")" == "3" ]]
}

validate_prior_auth_state_backup() {
  local state_file="$BACKUP_DIR/auth-prior-state.metadata"

  validate_root_file_mode "$state_file" 600
  [[ "$(wc -l <"$state_file")" == "7" ]] || return 1
  grep -Fxq "version=1" "$state_file" && \
    grep -Fxq "model=$PRIOR_AUTH_MODEL" "$state_file" && \
    grep -Fxq "container_id=$PRIOR_AUTH_CONTAINER_ID" "$state_file" && \
    grep -Fxq "project=$SUPABASE_COMPOSE_PROJECT" "$state_file" && \
    grep -Fxq "root=$SUPABASE_ROOT" "$state_file" && \
    grep -Fxq "service=auth" "$state_file" && \
    grep -Fxq "config_files=$PRIOR_AUTH_CONFIG_FILES" "$state_file"
}

validate_backup() {
  [[ "$(stat -c '%U:%G:%a' -- "$BACKUP_DIR")" == "root:root:700" ]] || die "Backup directory permissions are invalid."

  if (( had_template )); then
    validate_root_file_mode "$BACKUP_DIR/magic-link-otp.html" 600
    validate_root_file_mode "$BACKUP_DIR/template.metadata" 600
    [[ ! -e "$BACKUP_DIR/template.absent" ]] || die "Template backup state is ambiguous."
    cmp -s -- "$TARGET_TEMPLATE" "$BACKUP_DIR/magic-link-otp.html" || die "Template backup verification failed."
    grep -Eq '^[0-7]{3,4} [0-9]+ [0-9]+$' "$BACKUP_DIR/template.metadata" || die "Template metadata is invalid."
  else
    validate_root_file_mode "$BACKUP_DIR/template.absent" 600
    [[ ! -e "$BACKUP_DIR/magic-link-otp.html" && ! -e "$BACKUP_DIR/template.metadata" ]] || die "Template absence backup is ambiguous."
  fi

  if (( had_override )); then
    validate_root_file_mode "$BACKUP_DIR/docker-compose.email-otp.yml" 600
    validate_root_file_mode "$BACKUP_DIR/override.metadata" 600
    [[ ! -e "$BACKUP_DIR/override.absent" ]] || die "Override backup state is ambiguous."
    cmp -s -- "$TARGET_OVERRIDE" "$BACKUP_DIR/docker-compose.email-otp.yml" || die "Override backup verification failed."
    grep -Eq '^[0-7]{3,4} [0-9]+ [0-9]+$' "$BACKUP_DIR/override.metadata" || die "Override metadata is invalid."
  else
    validate_root_file_mode "$BACKUP_DIR/override.absent" 600
    [[ ! -e "$BACKUP_DIR/docker-compose.email-otp.yml" && ! -e "$BACKUP_DIR/override.metadata" ]] || die "Override absence backup is ambiguous."
  fi

  validate_backup_validator
  validate_prior_auth_state_backup
}

validate_backup_validator() {
  local expected_hash=""
  local actual_hash=""

  validate_root_file_mode "$BACKUP_VALIDATOR" 600
  validate_root_file_mode "$BACKUP_VALIDATOR_SHA256" 600
  IFS= read -r expected_hash <"$BACKUP_VALIDATOR_SHA256" || return 1
  [[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]] || return 1
  actual_hash="$(sha256sum "$BACKUP_VALIDATOR" | awk '{print $1}')" || return 1
  [[ "$actual_hash" == "$expected_hash" ]]
}

if (( EUID != 0 )); then
  die "Run this installer as root."
fi
if (( $# > 1 )); then
  die "Usage: $0 [SUPABASE_ROOT]"
fi

for command_name in docker install realpath stat cmp date grep sleep rm sha256sum awk wc chmod chown; do
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
readonly TEMPLATE_VALIDATOR="$SCRIPT_DIR/validate-email-otp-template.sh"
readonly BASE_COMPOSE="$SUPABASE_ROOT/docker-compose.yml"
readonly AAPANEL_OVERRIDE="$SUPABASE_ROOT/overrides/docker-compose.aapanel.yml"
readonly TARGET_OVERRIDE="$SUPABASE_ROOT/overrides/docker-compose.email-otp.yml"
readonly TARGET_TEMPLATE="$SUPABASE_ROOT/templates/magic-link-otp.html"

validate_exact_file "$SOURCE_TEMPLATE"
validate_exact_file "$SOURCE_OVERRIDE"
validate_exact_file "$TEMPLATE_VALIDATOR"
source "$TEMPLATE_VALIDATOR"
validate_email_otp_template "$SOURCE_TEMPLATE"
validate_exact_file "$BASE_COMPOSE"
validate_exact_file "$SUPABASE_ROOT/.env"
validate_exact_file "$AAPANEL_OVERRIDE"

if [[ -e "$TARGET_OVERRIDE" || -L "$TARGET_OVERRIDE" ]]; then
  validate_exact_file "$TARGET_OVERRIDE"
fi
if [[ -e "$TARGET_TEMPLATE" || -L "$TARGET_TEMPLATE" ]]; then
  validate_exact_file "$TARGET_TEMPLATE"
fi

SUPABASE_COMPOSE_PROJECT="$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' "$AUTH_CONTAINER" 2>/dev/null || true)"
[[ "$SUPABASE_COMPOSE_PROJECT" =~ ^[A-Za-z0-9_.-]+$ ]] || die "Could not validate the Supabase Compose project label."

cd -- "$SUPABASE_ROOT"
readonly -a BASE_COMPOSE_COMMAND=(
  docker compose
  --project-name "$SUPABASE_COMPOSE_PROJECT"
  -f docker-compose.yml
  -f overrides/docker-compose.aapanel.yml
)
readonly -a EXPECTED_OTP_COMPOSE_COMMAND=(
  docker compose
  --project-name "$SUPABASE_COMPOSE_PROJECT"
  -f docker-compose.yml
  -f overrides/docker-compose.aapanel.yml
  -f "$SOURCE_OVERRIDE"
)
readonly -a OTP_COMPOSE_COMMAND=(
  docker compose
  --project-name "$SUPABASE_COMPOSE_PROJECT"
  -f docker-compose.yml
  -f overrides/docker-compose.aapanel.yml
  -f overrides/docker-compose.email-otp.yml
)

"${BASE_COMPOSE_COMMAND[@]}" config --quiet
"${EXPECTED_OTP_COMPOSE_COMMAND[@]}" config --quiet
if [[ -f "$TARGET_OVERRIDE" ]]; then
  "${OTP_COMPOSE_COMMAND[@]}" config --quiet
fi

expected_model_auth_id="$("${EXPECTED_OTP_COMPOSE_COMMAND[@]}" ps -q auth)"
named_auth_id="$(docker inspect --format '{{.Id}}' "$AUTH_CONTAINER" 2>/dev/null || true)"
[[ -n "$expected_model_auth_id" && "$expected_model_auth_id" == "$named_auth_id" ]] || \
  die "The named Auth container is not the auth service in the expected three-file Compose model."

if [[ -f "$TARGET_OVERRIDE" ]]; then
  bind_auth_container "$BASE_COMPOSE,$AAPANEL_OVERRIDE,$TARGET_OVERRIDE" "${OTP_COMPOSE_COMMAND[@]}" || \
    die "Auth container labels do not match the current three-file Supabase model."
  PRIOR_AUTH_MODEL="base-aapanel-email-otp"
  PRIOR_AUTH_CONFIG_FILES="$BASE_COMPOSE,$AAPANEL_OVERRIDE,$TARGET_OVERRIDE"
else
  bind_auth_container "$BASE_COMPOSE,$AAPANEL_OVERRIDE" "${BASE_COMPOSE_COMMAND[@]}" || \
    die "Auth container labels do not match the current two-file Supabase model."
  PRIOR_AUTH_MODEL="base-aapanel"
  PRIOR_AUTH_CONFIG_FILES="$BASE_COMPOSE,$AAPANEL_OVERRIDE"
fi
PRIOR_AUTH_CONTAINER_ID="$AUTH_CONTAINER_ID"
auth_running="$(docker inspect --format '{{.State.Running}}' "$AUTH_CONTAINER_ID" 2>/dev/null || true)"
[[ "$auth_running" == "true" ]] || die "The validated $AUTH_CONTAINER container is not running."

ensure_secure_directory "$SUPABASE_ROOT/backups" 0700
ensure_secure_directory "$SUPABASE_ROOT/backups/email-otp" 0700
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
BACKUP_DIR="$SUPABASE_ROOT/backups/email-otp/$timestamp"
[[ ! -e "$BACKUP_DIR" && ! -L "$BACKUP_DIR" ]] || die "Backup path already exists: $BACKUP_DIR"
install -d -m 0700 -o root -g root -- "$BACKUP_DIR"
readonly BACKUP_VALIDATOR="$BACKUP_DIR/validate-email-otp-template.sh"
readonly BACKUP_VALIDATOR_SHA256="$BACKUP_DIR/validate-email-otp-template.sh.sha256"
readonly PRIOR_AUTH_STATE_BACKUP="$BACKUP_DIR/auth-prior-state.metadata"
install -m 0600 -o root -g root -- "$TEMPLATE_VALIDATOR" "$BACKUP_VALIDATOR"
cmp -s -- "$TEMPLATE_VALIDATOR" "$BACKUP_VALIDATOR" || die "Validator backup verification failed."
sha256sum "$BACKUP_VALIDATOR" | awk '{print $1}' >"$BACKUP_VALIDATOR_SHA256"
chmod 0600 -- "$BACKUP_VALIDATOR_SHA256"
chown root:root -- "$BACKUP_VALIDATOR_SHA256"
{
  printf 'version=1\n'
  printf 'model=%s\n' "$PRIOR_AUTH_MODEL"
  printf 'container_id=%s\n' "$PRIOR_AUTH_CONTAINER_ID"
  printf 'project=%s\n' "$SUPABASE_COMPOSE_PROJECT"
  printf 'root=%s\n' "$SUPABASE_ROOT"
  printf 'service=auth\n'
  printf 'config_files=%s\n' "$PRIOR_AUTH_CONFIG_FILES"
} >"$PRIOR_AUTH_STATE_BACKUP"
chmod 0600 -- "$PRIOR_AUTH_STATE_BACKUP"
chown root:root -- "$PRIOR_AUTH_STATE_BACKUP"

had_template=0
had_override=0
template_mode=0644
template_uid=0
template_gid=0
override_mode=0644
override_uid=0
override_gid=0

if [[ -f "$TARGET_TEMPLATE" ]]; then
  had_template=1
  stat -c '%a %u %g' -- "$TARGET_TEMPLATE" >"$BACKUP_DIR/template.metadata"
  chmod 0600 -- "$BACKUP_DIR/template.metadata"
  chown root:root -- "$BACKUP_DIR/template.metadata"
  install -m 0600 -o root -g root -- "$TARGET_TEMPLATE" "$BACKUP_DIR/magic-link-otp.html"
else
  install -m 0600 -o root -g root /dev/null "$BACKUP_DIR/template.absent"
fi

if [[ -f "$TARGET_OVERRIDE" ]]; then
  had_override=1
  stat -c '%a %u %g' -- "$TARGET_OVERRIDE" >"$BACKUP_DIR/override.metadata"
  chmod 0600 -- "$BACKUP_DIR/override.metadata"
  chown root:root -- "$BACKUP_DIR/override.metadata"
  install -m 0600 -o root -g root -- "$TARGET_OVERRIDE" "$BACKUP_DIR/docker-compose.email-otp.yml"
else
  install -m 0600 -o root -g root /dev/null "$BACKUP_DIR/override.absent"
fi

validate_backup
if (( had_template )); then
  read -r template_mode template_uid template_gid <"$BACKUP_DIR/template.metadata"
fi
if (( had_override )); then
  read -r override_mode override_uid override_gid <"$BACKUP_DIR/override.metadata"
fi

restore_backup() {
  if (( had_template )); then
    install -m "$template_mode" -o "$template_uid" -g "$template_gid" -- \
      "$BACKUP_DIR/magic-link-otp.html" "$TARGET_TEMPLATE" || return 1
  else
    rm -f -- "$TARGET_TEMPLATE" || return 1
  fi

  if (( had_override )); then
    install -m "$override_mode" -o "$override_uid" -g "$override_gid" -- \
      "$BACKUP_DIR/docker-compose.email-otp.yml" "$TARGET_OVERRIDE" || return 1
  else
    rm -f -- "$TARGET_OVERRIDE" || return 1
  fi
}

stop_template_containers() {
  local ids_file="$BACKUP_DIR/template-containers.ids"
  docker ps -aq \
    --filter "label=com.docker.compose.project=$SUPABASE_COMPOSE_PROJECT" \
    --filter "label=com.docker.compose.service=auth-email-templates" >"$ids_file" || return 1
  while IFS= read -r container_id; do
    [[ -n "$container_id" ]] || continue
    docker rm -f "$container_id" >/dev/null || return 1
  done <"$ids_file"
  rm -f -- "$ids_file"
}

restored_remote_otp_enabled() {
  [[ -f "$TARGET_OVERRIDE" ]] || return 1
  grep -Eq 'GOTRUE_MAILER_TEMPLATES_(MAGIC_LINK|CONFIRMATION)([[:space:]]*:|=)' \
    "$TARGET_OVERRIDE"
}

rollback() {
  local -a rollback_compose
  local rollback_config_files=""
  local live_prior_auth_id=""
  local named_auth_id=""
  local has_template_service=0
  local remote_otp_enabled=0

  printf 'Rolling back the email OTP deployment from %s.\n' "$BACKUP_DIR" >&2

  live_prior_auth_id="$(docker inspect --format '{{.Id}}' "$PRIOR_AUTH_CONTAINER_ID" 2>/dev/null || true)"
  named_auth_id="$(docker inspect --format '{{.Id}}' "$AUTH_CONTAINER" 2>/dev/null || true)"
  if [[ "$live_prior_auth_id" == "$PRIOR_AUTH_CONTAINER_ID" ]]; then
    [[ "$named_auth_id" == "$PRIOR_AUTH_CONTAINER_ID" ]] || return 1
    if [[ "$PRIOR_AUTH_MODEL" == "base-aapanel" ]]; then
      bind_auth_container "$PRIOR_AUTH_CONFIG_FILES" "${BASE_COMPOSE_COMMAND[@]}" || return 1
    elif [[ "$PRIOR_AUTH_MODEL" == "base-aapanel-email-otp" ]]; then
      bind_auth_container "$PRIOR_AUTH_CONFIG_FILES" "${OTP_COMPOSE_COMMAND[@]}" || return 1
    else
      return 1
    fi
    [[ "$AUTH_CONTAINER_ID" == "$PRIOR_AUTH_CONTAINER_ID" ]] || return 1
  elif (( auth_recreate_started )); then
    [[ "$named_auth_id" =~ ^[a-f0-9]{64}$ && "$named_auth_id" != "$PRIOR_AUTH_CONTAINER_ID" ]] || return 1
    bind_auth_container "$BASE_COMPOSE,$AAPANEL_OVERRIDE,$TARGET_OVERRIDE" "${OTP_COMPOSE_COMMAND[@]}" || return 1
    [[ "$AUTH_CONTAINER_ID" != "$PRIOR_AUTH_CONTAINER_ID" ]] || return 1
  else
    printf 'Auth container state is ambiguous; refusing rollback.\n' >&2
    return 1
  fi
  ensure_auth_stopped || return 1
  stop_template_containers || return 1
  restore_backup || return 1

  if (( had_override )); then
    rollback_compose=("${OTP_COMPOSE_COMMAND[@]}")
    rollback_config_files="$BASE_COMPOSE,$AAPANEL_OVERRIDE,$TARGET_OVERRIDE"
  else
    rollback_compose=("${BASE_COMPOSE_COMMAND[@]}")
    rollback_config_files="$BASE_COMPOSE,$AAPANEL_OVERRIDE"
  fi

  if ! "${rollback_compose[@]}" config --quiet; then
    return 1
  fi
  if "${rollback_compose[@]}" config --services | grep -Fxq auth-email-templates; then
    has_template_service=1
  fi
  if restored_remote_otp_enabled; then
    remote_otp_enabled=1
  fi

  if (( remote_otp_enabled )); then
    (( has_template_service )) || return 1
    validate_backup_validator || return 1
    printf 'Validating the restored OTP template with the protected backup validator.\n' >&2
    source "$BACKUP_VALIDATOR"
    validate_email_otp_template "$TARGET_TEMPLATE" || return 1
    "${rollback_compose[@]}" up -d --no-deps --force-recreate auth-email-templates || return 1
    wait_for_template_ready "$TARGET_TEMPLATE" 120 require-http-readiness "${rollback_compose[@]}" || return 1
  elif (( has_template_service )); then
    "${rollback_compose[@]}" up -d --no-deps --force-recreate auth-email-templates || return 1
    printf 'Restored state does not enable the managed remote OTP template; OTP safety was not asserted.\n' >&2
  else
    printf 'Restored state has no managed remote OTP template; OTP safety was not asserted.\n' >&2
  fi
  "${rollback_compose[@]}" up -d --no-deps --force-recreate auth || return 1
  bind_auth_container "$rollback_config_files" "${rollback_compose[@]}" || return 1
  wait_for_auth_healthy 120 || return 1

  printf 'Rollback completed and Supabase Auth is healthy.\n' >&2
}

mutation_started=0
rollback_started=0
on_error() {
  local exit_code="$1"
  local line_number="$2"

  if (( BASH_SUBSHELL > 0 )); then
    return "$exit_code"
  fi
  if (( rollback_started )); then
    exit "$exit_code"
  fi
  rollback_started=1
  trap - ERR INT TERM
  set +e
  printf 'Installation failed at line %s.\n' "$line_number" >&2
  if (( mutation_started )); then
    if ! rollback; then
      printf 'Rollback verification failed; keep production activation blocked.\n' >&2
    fi
  fi
  (( exit_code != 0 )) || exit_code=1
  exit "$exit_code"
}
trap 'on_error "$?" "$LINENO"' ERR
trap 'on_error 130 "$LINENO"' INT
trap 'on_error 143 "$LINENO"' TERM

mutation_started=1
auth_recreate_started=0
ensure_auth_stopped
ensure_secure_directory "$SUPABASE_ROOT/templates" 0755
ensure_secure_directory "$SUPABASE_ROOT/overrides" 0755
install -m 0644 -o root -g root -- "$SOURCE_TEMPLATE" "$TARGET_TEMPLATE"
install -m 0644 -o root -g root -- "$SOURCE_OVERRIDE" "$TARGET_OVERRIDE"

"${OTP_COMPOSE_COMMAND[@]}" config --quiet
"${OTP_COMPOSE_COMMAND[@]}" up -d --no-deps --force-recreate auth-email-templates
wait_for_template_ready "$SOURCE_TEMPLATE" 120 require-health "${OTP_COMPOSE_COMMAND[@]}"
auth_recreate_started=1
"${OTP_COMPOSE_COMMAND[@]}" up -d --no-deps --force-recreate auth
bind_auth_container "$BASE_COMPOSE,$AAPANEL_OVERRIDE,$TARGET_OVERRIDE" "${OTP_COMPOSE_COMMAND[@]}"
wait_for_auth_healthy 120
verify_auth_template_configuration

mutation_started=0
trap - ERR INT TERM
rm -f -- \
  "$BACKUP_DIR/served-template.check" \
  "$BACKUP_DIR/expected-template.sha256" \
  "$BACKUP_DIR/served-template.sha256" \
  "$BACKUP_DIR/auth-template-configuration.check" \
  "$BACKUP_DIR/template-container.id" \
  "$BACKUP_DIR/template-container.state" \
  "$BACKUP_DIR/template-containers.ids" \
  "$BACKUP_DIR/auth-running.state"
printf 'Email OTP template installed successfully.\n'
printf 'BACKUP_PATH=%s\n' "$BACKUP_DIR"
