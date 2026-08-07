#!/usr/bin/env bash
# Apply OpenKeep GCP infra from repo-root .env (Neon + admin secrets).
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INFRA_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${ENV_FILE:-$ROOT_DIR/.env}"

die() {
  echo "error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "'$1' is required but not installed"
}

# Load KEY=VALUE pairs from .env without executing arbitrary shell.
load_env_file() {
  local file="$1"
  [[ -f "$file" ]] || die "missing env file: $file (copy .env.example to .env and fill Neon/admin values)"

  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    [[ -z "$line" || "$line" =~ ^[[:space:]]*# ]] && continue
    if [[ "$line" =~ ^([A-Za-z_][A-Za-z0-9_]*)=(.*)$ ]]; then
      local key="${BASH_REMATCH[1]}"
      local value="${BASH_REMATCH[2]}"
      if [[ "$value" =~ ^\"(.*)\"$ ]]; then
        value="${BASH_REMATCH[1]}"
      elif [[ "$value" =~ ^\'(.*)\'$ ]]; then
        value="${BASH_REMATCH[1]}"
      fi
      export "$key=$value"
    fi
  done <"$file"
}

require_non_placeholder() {
  local name="$1"
  local value="${!name:-}"
  [[ -n "$value" ]] || die "$name is empty in $ENV_FILE"
  [[ "$value" != *CHANGE_ME* ]] || die "$name still has a CHANGE_ME placeholder in $ENV_FILE"
}

# Split a Neon/libpq or JDBC URL into JDBC URL + user + password for Cloud Run / current images.
parse_database_url() {
  local raw="$1"
  python3 - "$raw" <<'PY'
import sys
from urllib.parse import urlparse, unquote, parse_qsl, urlencode

raw = sys.argv[1].strip()
if raw.startswith("jdbc:"):
    raw = raw[len("jdbc:"):]

if not (raw.startswith("postgres://") or raw.startswith("postgresql://")):
    raise SystemExit("OPENKEEP_DATABASE_URL must be postgres://, postgresql://, or jdbc:postgresql://")

u = urlparse(raw)
if not u.hostname:
    raise SystemExit("OPENKEEP_DATABASE_URL is missing a host")
user = unquote(u.username or "")
password = unquote(u.password or "")
if not user or password is None or password == "":
    raise SystemExit("OPENKEEP_DATABASE_URL must include user:password@")

path = u.path or "/openkeep"
params = dict(parse_qsl(u.query, keep_blank_values=True))
# JDBC uses channelBinding; Neon libpq URIs use channel_binding.
if "channel_binding" in params and "channelBinding" not in params:
    params["channelBinding"] = params.pop("channel_binding")
elif "channel_binding" in params:
    params.pop("channel_binding")
if u.hostname not in ("localhost", "127.0.0.1", "db") and "sslmode" not in params:
    params["sslmode"] = "require"

netloc = u.hostname if u.port is None else f"{u.hostname}:{u.port}"
query = urlencode(params)
jdbc = f"jdbc:postgresql://{netloc}{path}"
if query:
    jdbc = f"{jdbc}?{query}"

# Emit shell-safe assignments via printf %q-equivalent for bash
import shlex
print(f"PARSED_JDBC={shlex.quote(jdbc)}")
print(f"PARSED_USER={shlex.quote(user)}")
print(f"PARSED_PASSWORD={shlex.quote(password)}")
PY
}

require_cmd tofu
require_cmd gcloud
require_cmd python3

load_env_file "$ENV_FILE"

PROJECT_ID="${GCP_PROJECT_ID:-}"
REGION="${GCP_REGION:-}"
IMAGE="${OPENKEEP_IMAGE:-docker.io/rzarajczyk/openkeep:latest}"

[[ -n "$PROJECT_ID" ]] || die "GCP_PROJECT_ID is required in $ENV_FILE"
[[ -n "$REGION" ]] || die "GCP_REGION is required in $ENV_FILE"
require_non_placeholder OPENKEEP_DATABASE_URL
require_non_placeholder OPENKEEP_ADMIN_USERNAME
require_non_placeholder OPENKEEP_ADMIN_PASSWORD

eval "$(parse_database_url "$OPENKEEP_DATABASE_URL")"

ACTIVE_PROJECT="$(gcloud config get-value project 2>/dev/null || true)"
if [[ "$ACTIVE_PROJECT" != "$PROJECT_ID" ]]; then
  echo "note: gcloud project is '${ACTIVE_PROJECT:-unset}'; setup will use project_id=$PROJECT_ID via OpenTofu"
fi

export TF_VAR_project_id="$PROJECT_ID"
export TF_VAR_region="$REGION"
export TF_VAR_image="$IMAGE"
export TF_VAR_database_url="$PARSED_JDBC"
export TF_VAR_database_user="$PARSED_USER"
export TF_VAR_database_password="$PARSED_PASSWORD"
export TF_VAR_admin_username="$OPENKEEP_ADMIN_USERNAME"
export TF_VAR_admin_password="$OPENKEEP_ADMIN_PASSWORD"

cd "$INFRA_DIR"

echo "==> tofu init"
tofu init -input=false

echo "==> tofu apply"
tofu apply -input=false -auto-approve

echo
echo "==> Applied. Configure these GitHub Actions repository secrets:"
tofu output -json github_actions_secrets | python3 -c '
import json, sys
data = json.load(sys.stdin)
for k, v in data.items():
    print(f"  {k}={v}")
'

echo
echo "Cloud Run URL:"
tofu output -raw cloud_run_url
echo
echo
echo "Attachments bucket:"
tofu output -raw attachments_bucket
echo
