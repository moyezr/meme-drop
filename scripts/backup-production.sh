#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
environment_file="${MEMEDROP_PRODUCTION_ENV_FILE:-$repo_root/.env.prod}"

if [[ ! -f "$environment_file" ]]; then
  echo "[MemeDrop] production environment file not found: $environment_file" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1090
source "$environment_file"
set +a

required_variables=(
  DATABASE_URL
  MEMEDROP_ENV
  S3_ACCESS_KEY_ID
  S3_BUCKET_NAME
  S3_ENDPOINT
  S3_REGION
  S3_SECRET_ACCESS_KEY
)
for variable_name in "${required_variables[@]}"; do
  if [[ -z "${!variable_name:-}" ]]; then
    echo "[MemeDrop] $variable_name is required for a production backup." >&2
    exit 1
  fi
done
if [[ "$MEMEDROP_ENV" != "production" || "$S3_BUCKET_NAME" != "meme-drop-prod" ]]; then
  echo "[MemeDrop] backup refused: expected production and meme-drop-prod." >&2
  exit 1
fi

for command_name in aws pg_dump shasum; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[MemeDrop] required command is unavailable: $command_name" >&2
    exit 1
  fi
done

backup_root="${MEMEDROP_BACKUP_ROOT:-$HOME/.memedrop/backups}"
snapshot_name="$(date -u +%Y%m%dT%H%M%SZ)"
snapshot_dir="$backup_root/$snapshot_name"
database_dump="$snapshot_dir/database.dump"
storage_dir="$snapshot_dir/storage"

umask 077
mkdir -p "$storage_dir"

cleanup_incomplete_snapshot() {
  if [[ ! -f "$snapshot_dir/COMPLETE" ]]; then
    SNAPSHOT_DIR="$snapshot_dir" python3 -c \
      'import os, shutil; shutil.rmtree(os.environ["SNAPSHOT_DIR"], ignore_errors=True)'
  fi
}
trap cleanup_incomplete_snapshot EXIT

PGSSLMODE=require pg_dump \
  --format=custom \
  --no-owner \
  --no-acl \
  --table='public.*' \
  --file="$database_dump" \
  "$DATABASE_URL"

AWS_ACCESS_KEY_ID="$S3_ACCESS_KEY_ID" \
AWS_SECRET_ACCESS_KEY="$S3_SECRET_ACCESS_KEY" \
AWS_DEFAULT_REGION="$S3_REGION" \
  aws --endpoint-url "$S3_ENDPOINT" s3 sync \
    "s3://$S3_BUCKET_NAME" "$storage_dir" --only-show-errors

(
  cd "$snapshot_dir"
  find database.dump storage -type f -print0 \
    | LC_ALL=C sort -z \
    | xargs -0 shasum -a 256 > manifest.sha256
)

touch "$snapshot_dir/COMPLETE"
chmod -R go-rwx "$snapshot_dir"

storage_objects="$(find "$storage_dir" -type f | wc -l | tr -d ' ')"
snapshot_bytes="$(du -sk "$snapshot_dir" | awk '{print $1 * 1024}')"
echo "[MemeDrop] production backup complete"
echo "snapshot=$snapshot_dir"
echo "storage_objects=$storage_objects"
echo "snapshot_bytes=$snapshot_bytes"
