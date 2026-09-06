#!/usr/bin/env bash

set -euo pipefail
set -o pipefail

if [[ $# -ne 1 ]]; then
  echo "Usage: npm run ops:verify-backup -- /absolute/path/to/snapshot" >&2
  exit 2
fi

snapshot_dir="$(cd "$1" && pwd)"
database_dump="$snapshot_dir/database.dump"
manifest="$snapshot_dir/manifest.sha256"
restore_database="memedrop_restore_test"
restore_url="postgresql://postgres:postgres@127.0.0.1:5432/$restore_database"

for required_file in "$snapshot_dir/COMPLETE" "$database_dump" "$manifest"; do
  if [[ ! -f "$required_file" ]]; then
    echo "[MemeDrop] incomplete backup: missing $required_file" >&2
    exit 1
  fi
done
for command_name in createdb dropdb pg_restore psql shasum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[MemeDrop] required command is unavailable: $command_name" >&2
    exit 1
  fi
done

(
  cd "$snapshot_dir"
  shasum -a 256 --check manifest.sha256
)

cleanup_restore_database() {
  PGPASSWORD=postgres dropdb --if-exists \
    -h 127.0.0.1 -U postgres "$restore_database" >/dev/null 2>&1 || true
}
trap cleanup_restore_database EXIT

cleanup_restore_database
PGPASSWORD=postgres createdb -h 127.0.0.1 -U postgres "$restore_database"
PGPASSWORD=postgres psql -q -v ON_ERROR_STOP=1 "$restore_url" \
  -c 'CREATE EXTENSION IF NOT EXISTS vector'

# PostgreSQL 17 dumps include transaction_timeout, which PostgreSQL 15 does not know.
# Filtering this session-only setting keeps the recovery drill compatible with the
# repository's pgvector/pgvector:pg15 disposable database.
pg_restore --no-owner --no-acl --file=- "$database_dump" \
  | sed '/^SET transaction_timeout = 0;$/d' \
  | PGPASSWORD=postgres psql -q -v ON_ERROR_STOP=1 "$restore_url"

table_count="$(PGPASSWORD=postgres psql "$restore_url" -At -c \
  "select count(*) from pg_tables where schemaname = 'public'")"
schema_version="$(PGPASSWORD=postgres psql "$restore_url" -At -c \
  'select version_num from alembic_version')"
storage_objects="$(find "$snapshot_dir/storage" -type f | wc -l | tr -d ' ')"

if [[ "$table_count" -lt 18 || -z "$schema_version" || "$storage_objects" -lt 1 ]]; then
  echo "[MemeDrop] restored backup failed structural verification." >&2
  exit 1
fi

echo "[MemeDrop] production backup verified"
echo "schema_version=$schema_version"
echo "tables=$table_count"
echo "storage_objects=$storage_objects"
