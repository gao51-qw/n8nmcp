#!/usr/bin/env bash
set -Eeuo pipefail

NEW_TAG="${1:?usage: update-knowledge.sh <tag> <expected-template-count>}"
EXPECTED_TEMPLATES="${2:?usage: update-knowledge.sh <tag> <expected-template-count>}"
ENV_FILE="${ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

[[ "$NEW_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid image tag" >&2; exit 2; }
[[ "$EXPECTED_TEMPLATES" =~ ^[0-9]+$ ]] || { echo "invalid template count" >&2; exit 2; }

OLD_TAG="$(grep -m1 -E '^MCP_IMAGE_TAG=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
GHCR_OWNER="$(grep -m1 -E '^GHCR_OWNER=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')"
[[ -n "$OLD_TAG" ]] || { echo "MCP_IMAGE_TAG is missing" >&2; exit 2; }
[[ "$OLD_TAG" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid existing image tag" >&2; exit 2; }
[[ "$GHCR_OWNER" =~ ^[A-Za-z0-9._-]+$ ]] || { echo "invalid GHCR owner" >&2; exit 2; }

IMAGE="ghcr.io/${GHCR_OWNER}/n8n-knowledge-mcp"
ROLLING_BACK=0

set_tag() {
  local tag="$1"
  local temporary
  temporary="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
  awk -v tag="$tag" '
    BEGIN { replaced = 0 }
    /^MCP_IMAGE_TAG=/ {
      print "MCP_IMAGE_TAG=" tag
      replaced = 1
      next
    }
    { print }
    END {
      if (!replaced) print "MCP_IMAGE_TAG=" tag
    }
  ' "$ENV_FILE" > "$temporary"
  mv -- "$temporary" "$ENV_FILE"
}

wait_for_health() {
  local expected="$1"
  local deadline=$((SECONDS + 120))
  local status=""

  while (( SECONDS < deadline )); do
    status="$(docker inspect --format '{{.State.Health.Status}}' n8n-knowledge-mcp 2>/dev/null || true)"
    [[ "$status" == "healthy" ]] && break
    sleep 2
  done
  [[ "$status" == "healthy" ]] || { echo "mcp container did not become healthy" >&2; return 1; }

  docker exec n8n-knowledge-mcp node -e '
    const expected = process.argv[1];
    fetch("http://127.0.0.1:3000/health", {
      headers: { authorization: `Bearer ${process.env.AUTH_TOKEN}` },
    }).then(async (response) => {
      if (!response.ok) throw new Error("authenticated health check failed");
      const body = await response.json();
      if (expected && body.templates !== Number(expected)) {
        throw new Error("template count mismatch");
      }
    }).catch((error) => {
      console.error(error.message);
      process.exit(1);
    });
  ' "$expected"
}

rollback() {
  local failed_status=$?
  trap - ERR
  if (( ROLLING_BACK )); then
    exit "$failed_status"
  fi
  ROLLING_BACK=1
  echo "knowledge deployment failed; rolling back mcp" >&2
  set_tag "$OLD_TAG"
  docker compose -f "$COMPOSE_FILE" up -d --no-deps mcp
  if ! wait_for_health ""; then
    echo "rollback health verification failed" >&2
  fi
  (( failed_status != 0 )) || failed_status=1
  exit "$failed_status"
}

cp -p -- "$ENV_FILE" "${ENV_FILE}.bak"
trap rollback ERR

docker pull "${IMAGE}:${NEW_TAG}"
set_tag "$NEW_TAG"
docker compose -f "$COMPOSE_FILE" up -d --no-deps mcp
wait_for_health "$EXPECTED_TEMPLATES"
rm -f -- "${ENV_FILE}.bak"
