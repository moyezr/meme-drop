#!/usr/bin/env bash

set -euo pipefail
set -o pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "[MemeDrop] encrypted iCloud archival is supported only on macOS." >&2
  exit 1
fi
if [[ $# -ne 1 ]]; then
  echo "Usage: npm run ops:archive-backup:macos -- /absolute/path/to/verified-snapshot" >&2
  exit 2
fi
for command_name in openssl security tar; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "[MemeDrop] required command is unavailable: $command_name" >&2
    exit 1
  fi
done

backup_root="$(cd "$HOME/.memedrop/backups" && pwd)"
snapshot_dir="$(cd "$1" && pwd)"
case "$snapshot_dir" in
  "$backup_root"/*) ;;
  *)
    echo "[MemeDrop] snapshot must be a child of $backup_root" >&2
    exit 1
    ;;
esac
if [[ ! -f "$snapshot_dir/COMPLETE" || ! -f "$snapshot_dir/VERIFIED" ]]; then
  echo "[MemeDrop] snapshot must pass ops:verify-backup before encrypted archival." >&2
  exit 1
fi

snapshot_id="$(basename "$snapshot_dir")"
archive_dir="${MEMEDROP_BACKUP_ARCHIVE_DIR:-$HOME/Library/Mobile Documents/com~apple~CloudDocs/MemeDrop Backups}"
archive_path="$archive_dir/$snapshot_id.tar.gz.enc"
temporary_archive="$archive_path.tmp.$$"
service_name="MemeDrop production backup encryption"
account_name="operator-archive"

mkdir -p "$archive_dir"
chmod 700 "$archive_dir"
archive_key="$(security find-generic-password -a "$account_name" -s "$service_name" -w 2>/dev/null || true)"
if [[ -z "$archive_key" ]]; then
  archive_key="$(openssl rand -base64 48)"
  security add-generic-password -U -a "$account_name" -s "$service_name" \
    -w "$archive_key" >/dev/null
fi

cleanup_temporary_archive() {
  if [[ -f "$temporary_archive" ]]; then
    python3 - "$temporary_archive" <<'PY'
from pathlib import Path
import sys

Path(sys.argv[1]).unlink(missing_ok=True)
PY
  fi
}
trap cleanup_temporary_archive EXIT

archive_pass="$archive_key" tar -C "$backup_root" -czf - "$snapshot_id" \
  | archive_pass="$archive_key" openssl enc -aes-256-cbc -salt -pbkdf2 -iter 600000 \
      -pass env:archive_pass -out "$temporary_archive"
archive_pass="$archive_key" openssl enc -d -aes-256-cbc -pbkdf2 -iter 600000 \
  -pass env:archive_pass -in "$temporary_archive" | tar -tzf - >/dev/null
chmod 600 "$temporary_archive"
mv "$temporary_archive" "$archive_path"

python3 - "$snapshot_dir" <<'PY'
from pathlib import Path
import shutil
import sys

snapshot = Path(sys.argv[1])
shutil.rmtree(snapshot)
PY

echo "[MemeDrop] verified backup archived with AES-256 encryption"
echo "archive=$archive_path"
echo "keychain_service=$service_name"
