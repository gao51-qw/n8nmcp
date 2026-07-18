#!/usr/bin/env bash
set -Eeuo pipefail

MIGRATIONS_DIR="/opt/n8nmcp-app/supabase/migrations"
DB_CONTAINER="supabase-db"

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 -c '
  create schema if not exists n8nmcp_deploy;
  create table if not exists n8nmcp_deploy.schema_migrations (
    version text primary key,
    applied_at timestamptz not null default now()
  );
' >/dev/null

applied=0
skipped=0

while IFS= read -r migration; do
  filename="$(basename "$migration")"
  version="${filename%.sql}"
  [[ "$version" =~ ^[A-Za-z0-9_-]+$ ]] || {
    echo "Invalid migration filename: $filename" >&2
    exit 2
  }

  exists="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
    "select 1 from n8nmcp_deploy.schema_migrations where version = '$version'")"
  if [[ "$exists" == "1" ]]; then
    echo "SKIP  $filename"
    skipped=$((skipped + 1))
    continue
  fi

  echo "APPLY $filename"
  {
    printf 'begin;\n'
    cat "$migration"
    printf '\ninsert into n8nmcp_deploy.schema_migrations(version) values ('"'"'%s'"'"');\n' "$version"
    printf 'commit;\n'
  } | docker exec -i "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 >/dev/null
  applied=$((applied + 1))
done < <(find "$MIGRATIONS_DIR" -maxdepth 1 -type f -name '*.sql' | sort)

docker exec "$DB_CONTAINER" psql -U postgres -d postgres -v ON_ERROR_STOP=1 \
  -c "notify pgrst, 'reload schema';" >/dev/null

total="$(docker exec "$DB_CONTAINER" psql -U postgres -d postgres -tAc \
  'select count(*) from n8nmcp_deploy.schema_migrations')"
echo "MIGRATIONS_APPLIED=$applied"
echo "MIGRATIONS_SKIPPED=$skipped"
echo "MIGRATIONS_TOTAL=$total"
