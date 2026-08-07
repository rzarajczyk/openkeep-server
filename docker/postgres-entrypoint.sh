#!/bin/sh
# Derive POSTGRES_* for the official Postgres image from OWNKEEP_DATABASE_URL.
set -eu

url="${OWNKEEP_DATABASE_URL:-}"
if [ -z "$url" ]; then
  echo "OWNKEEP_DATABASE_URL is required" >&2
  exit 1
fi

# Strip jdbc: prefix if present so URI parsing is uniform.
case "$url" in
  jdbc:*) url="${url#jdbc:}" ;;
esac

case "$url" in
  postgres://*|postgresql://*) ;;
  *)
    echo "OWNKEEP_DATABASE_URL must be a postgres://, postgresql://, or jdbc:postgresql:// URL" >&2
    exit 1
    ;;
esac

rest="${url#*://}"
userinfo="${rest%%@*}"
hostpath="${rest#*@}"
if [ "$userinfo" = "$rest" ]; then
  echo "OWNKEEP_DATABASE_URL must include user:password@" >&2
  exit 1
fi

# Split on the first colon so passwords may contain ':' (URL-encoded as %3A).
user="${userinfo%%:*}"
pass="${userinfo#*:}"
if [ "$user" = "$userinfo" ] || [ -z "$pass" ]; then
  echo "OWNKEEP_DATABASE_URL must include user:password@" >&2
  exit 1
fi

pathquery="${hostpath#*/}"
db="${pathquery%%\?*}"
db="${db:-ownkeep}"

# Full percent-decode (+ → space, %XX → byte). Works on BusyBox ash/sed.
decode() {
  printf '%b' "$(printf '%s' "$1" | sed -e 's/+/ /g' -e 's/%\([0-9A-Fa-f][0-9A-Fa-f]\)/\\x\1/g')"
}

export POSTGRES_USER="$(decode "$user")"
export POSTGRES_PASSWORD="$(decode "$pass")"
export POSTGRES_DB="$db"

exec docker-entrypoint.sh postgres
