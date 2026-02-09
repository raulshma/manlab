#!/usr/bin/env bash
set -euo pipefail

output_dir="aspire-output"
server_image=""
web_image=""
pg_password=""
nats_password=""
server_port="8081"

usage() {
  cat <<'EOF'
Usage:
  publish-compose-bundle.sh [--output-dir DIR] [--server-image IMAGE] [--web-image IMAGE] [--pgpassword PWD] [--nats-password PWD] [--server-port PORT]

Notes:
  - Requires the Aspire CLI ('aspire') to be installed and on PATH.
  - This script runs 'aspire publish' then stamps aspire-output/.env with image references.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output-dir)
      output_dir="$2"; shift 2;;
    --server-image)
      server_image="$2"; shift 2;;
    --web-image)
      web_image="$2"; shift 2;;
    --pgpassword)
      pg_password="$2"; shift 2;;
    --server-port)
      server_port="$2"; shift 2;;
    --nats-password)
      nats_password="$2"; shift 2;;
    -h|--help)
      usage; exit 0;;
    *)
      echo "Unknown argument: $1" >&2
      usage
      exit 2;;
  esac
done

if ! command -v aspire >/dev/null 2>&1; then
  echo "Aspire CLI ('aspire') not found on PATH. Install it: https://aspire.dev/get-started/install-cli/" >&2
  exit 1
fi

mkdir -p "$output_dir"

echo "Publishing Docker Compose bundle to '$output_dir'..."
aspire publish -o "$output_dir"

env_path="$output_dir/.env"
env_example_path="$output_dir/.env.example"

cat >"$env_path" <<EOF
PGPASSWORD=$pg_password
NATS_PASSWORD=$nats_password
SERVER_IMAGE=$server_image
WEB_IMAGE=$web_image
SERVER_PORT=$server_port
EOF

echo "Wrote '$env_path'."

cat >"$env_example_path" <<EOF
PGPASSWORD=CHANGEME
NATS_PASSWORD=CHANGEME
SERVER_IMAGE=$server_image
WEB_IMAGE=$web_image
SERVER_PORT=$server_port
EOF

echo "Wrote '$env_example_path'."
