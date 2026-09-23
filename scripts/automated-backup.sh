#!/usr/bin/env bash
set -Eeuo pipefail

# Production Linux entrypoint for the existing backup script. It intentionally
# uses only standard shell utilities, Node, Docker Compose, ssh, and scp.

ROOT_DIR="${DEVSIGNAL_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="${DEVSIGNAL_ENV_FILE:-$ROOT_DIR/.env.deploy}"
BACKUP_ROOT="${DEVSIGNAL_BACKUP_ROOT:-$ROOT_DIR/backups}"
LOCK_FILE="${DEVSIGNAL_BACKUP_LOCK:-/var/lock/devsignal-backup.lock}"
PROJECT="${DEVSIGNAL_COMPOSE_PROJECT:-devsignal-https}"
COMPOSE_FILE="${DEVSIGNAL_COMPOSE_FILE:-$ROOT_DIR/docker-compose.deploy.yml}"
COLLECTION="${DEVSIGNAL_QDRANT_COLLECTION:-devsignal_knowledge_chunks}"
RETENTION_COUNT="${DEVSIGNAL_BACKUP_RETENTION:-7}"
REMOTE_DESTINATION="${DEVSIGNAL_BACKUP_SSH_DESTINATION:-}"
REMOTE_ROOT="${DEVSIGNAL_BACKUP_REMOTE_ROOT:-}"
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: automated-backup.sh [--dry-run]

Environment:
  DEVSIGNAL_ROOT, DEVSIGNAL_ENV_FILE, DEVSIGNAL_BACKUP_ROOT
  DEVSIGNAL_BACKUP_LOCK, DEVSIGNAL_COMPOSE_PROJECT, DEVSIGNAL_COMPOSE_FILE
  DEVSIGNAL_QDRANT_COLLECTION, DEVSIGNAL_BACKUP_RETENTION
  DEVSIGNAL_BACKUP_SSH_DESTINATION (optional user@host)
  DEVSIGNAL_BACKUP_REMOTE_ROOT (optional absolute remote directory)
EOF
}

for argument in "$@"; do
  case "$argument" in
    --dry-run) DRY_RUN=1 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $argument" >&2; exit 2 ;;
  esac
done

fail() {
  echo "automated backup failed: $*" >&2
  exit 1
}

[[ -f "$ENV_FILE" ]] || fail "environment file not found: $ENV_FILE"
[[ "$RETENTION_COUNT" =~ ^[1-9][0-9]*$ ]] || fail "retention must be a positive integer"
[[ "$BACKUP_ROOT" = /* ]] || fail "backup root must be absolute"
[[ "$LOCK_FILE" = /* ]] || fail "lock path must be absolute"
[[ "$REMOTE_DESTINATION" == "" || "$REMOTE_DESTINATION" =~ ^[^:/[:space:]]+@[^:/[:space:]]+$ ]] ||
  fail "SSH destination must be user@host"
[[ "$REMOTE_DESTINATION" == "" || "$REMOTE_ROOT" = /* ]] ||
  fail "remote backup root must be absolute when SSH copying is enabled"
[[ "$REMOTE_ROOT" == "" || "$REMOTE_ROOT" =~ ^/[A-Za-z0-9._/-]+$ ]] ||
  fail "remote backup root contains unsupported characters"

mkdir -p "$BACKUP_ROOT"
chmod 700 "$BACKUP_ROOT"
exec 9>"$LOCK_FILE"
if ! flock -n 9; then
  echo "backup already running; exiting without changes" >&2
  exit 0
fi

read_env_value() {
  local name="$1"
  awk -F= -v key="$name" '$1 == key {sub(/^[^=]*=/, ""); print; exit}' "$ENV_FILE"
}

WORKFLOW_DATABASE="${DEVSIGNAL_WORKFLOW_DATABASE:-$(read_env_value WORKFLOW_CHECKPOINT_DATABASE)}"
WORKFLOW_DATABASE="${WORKFLOW_DATABASE:-devsignal_workflows}"
[[ "$WORKFLOW_DATABASE" =~ ^[A-Za-z0-9_-]+$ ]] || fail "unsafe workflow database name"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
output="$BACKUP_ROOT/$timestamp"
[[ ! -e "$output" ]] || fail "backup output already exists: $output"

validate_manifest() {
  local directory="$1"
  local manifest="$directory/backup-manifest.json"
  [[ -f "$manifest" ]] || return 1
  node --input-type=module - "$manifest" "$directory" <<'NODE'
import { readFile } from "node:fs/promises";
import { validateManifest } from "./scripts/backup-workflow.mjs";
const manifestPath = process.argv[2];
const directory = process.argv[3];
await validateManifest(JSON.parse(await readFile(manifestPath, "utf8")), directory);
NODE
}

remote_verified=0
upload_backup() {
  [[ -n "$REMOTE_DESTINATION" ]] || return 0
  [[ -n "$REMOTE_ROOT" ]] || fail "DEVSIGNAL_BACKUP_REMOTE_ROOT is required with SSH destination"
  local name tmp remote_manifest local_hash remote_hash
  name="$(basename "$output")"
  tmp="$REMOTE_ROOT/.${name}.partial"
  remote_manifest="$REMOTE_ROOT/$name/backup-manifest.json"
  local_hash="$(sha256sum "$output/backup-manifest.json" | awk '{print $1}')"
  echo "Uploading backup to $REMOTE_DESTINATION:$REMOTE_ROOT/$name"
  ssh "$REMOTE_DESTINATION" "umask 077; rm -rf -- '$tmp'; mkdir -p -- '$tmp'"
  scp -q -r "$output/." "$REMOTE_DESTINATION:$tmp/"
  for local_file in "$output"/*; do
    local base remote_hash_for_file local_hash_for_file
    [[ -f "$local_file" ]] || continue
    base="$(basename "$local_file")"
    local_hash_for_file="$(sha256sum "$local_file" | awk '{print $1}')"
    remote_hash_for_file="$(ssh "$REMOTE_DESTINATION" "sha256sum '$tmp/$base' | awk '{print \$1}'")"
    [[ "$remote_hash_for_file" == "$local_hash_for_file" ]] ||
      fail "remote checksum verification failed for $base"
  done
  ssh "$REMOTE_DESTINATION" "test -f '$tmp/backup-manifest.json'; test \"\$(sha256sum '$tmp/backup-manifest.json' | awk '{print \$1}')\" = '$local_hash'; mv -- '$tmp' '$REMOTE_ROOT/$name'"
  remote_hash="$(ssh "$REMOTE_DESTINATION" "sha256sum '$remote_manifest' | awk '{print \$1}'")"
  [[ "$remote_hash" == "$local_hash" ]] || fail "remote manifest checksum verification failed"
  remote_verified=1
}

prune_backups() {
  local -a completed=()
  while IFS= read -r manifest; do
    local directory="${manifest%/backup-manifest.json}"
    if validate_manifest "$directory" >/dev/null 2>&1; then
      completed+=("$directory")
    fi
  done < <(find "$BACKUP_ROOT" -mindepth 2 -maxdepth 2 -type f -name backup-manifest.json -print | sort)
  ((${#completed[@]} > 0)) || return 0
  local keep="$RETENTION_COUNT"
  local index=0
  for (( index=${#completed[@]}-keep-1; index>=0; index-- )); do
    local candidate="${completed[$index]}"
    [[ "$candidate" != "$output" ]] || continue
    if [[ -n "$REMOTE_DESTINATION" ]]; then
      candidate_name="$(basename "$candidate")"
      remote_candidate_manifest="$REMOTE_ROOT/$candidate_name/backup-manifest.json"
      remote_candidate_hash="$(ssh "$REMOTE_DESTINATION" "test -f '$remote_candidate_manifest' && sha256sum '$remote_candidate_manifest' | awk '{print \$1}'" 2>/dev/null || true)"
      local_candidate_hash="$(sha256sum "$candidate/backup-manifest.json" | awk '{print $1}')"
      [[ "$remote_candidate_hash" == "$local_candidate_hash" ]] || {
        echo "retention: preserving $candidate because upload is not verified" >&2
        continue
      }
    fi
    if (( DRY_RUN )); then
      echo "dry-run: would remove completed backup $candidate"
    else
      rm -rf -- "$candidate"
    fi
  done
}

if (( DRY_RUN )); then
  echo "dry-run: lock acquired; no Docker, SSH, SCP, deletion, or backup output will be created"
  env DEVSIGNAL_ROOT="$ROOT_DIR" node "$ROOT_DIR/scripts/backup.mjs" \
    --project "$PROJECT" --compose-file "$COMPOSE_FILE" --env-path "$ENV_FILE" \
    --output "$output" --collection "$COLLECTION" \
    --workflow-database "$WORKFLOW_DATABASE" --dry-run
  prune_backups
  exit 0
fi

umask 077
env DEVSIGNAL_ROOT="$ROOT_DIR" node "$ROOT_DIR/scripts/backup.mjs" \
  --project "$PROJECT" --compose-file "$COMPOSE_FILE" --env-path "$ENV_FILE" \
  --output "$output" --collection "$COLLECTION" \
  --workflow-database "$WORKFLOW_DATABASE"
chmod -R u=rwX,go= "$output"
validate_manifest "$output" || fail "new backup manifest failed validation"
upload_backup
prune_backups
echo "backup complete: $output"
