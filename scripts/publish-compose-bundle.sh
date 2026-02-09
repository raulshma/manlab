#!/usr/bin/env bash
set -euo pipefail

output_dir="aspire-output"
server_image=""
web_image=""
pg_password=""
nats_password=""
server_port="8081"
postgres_memory_limit="512M"
postgres_cpu_limit="1.50"
nats_memory_limit="96M"
nats_cpu_limit="0.50"
valkey_memory_limit="192M"
valkey_cpu_limit="0.75"
server_memory_limit="768M"
server_cpu_limit="1.50"
web_memory_limit="128M"
web_cpu_limit="0.50"
server_gc_heap_hard_limit_percent="70"
server_gc_conserve_memory="1"

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
POSTGRES_MEMORY_LIMIT=$postgres_memory_limit
POSTGRES_CPU_LIMIT=$postgres_cpu_limit
NATS_MEMORY_LIMIT=$nats_memory_limit
NATS_CPU_LIMIT=$nats_cpu_limit
VALKEY_MEMORY_LIMIT=$valkey_memory_limit
VALKEY_CPU_LIMIT=$valkey_cpu_limit
SERVER_MEMORY_LIMIT=$server_memory_limit
SERVER_CPU_LIMIT=$server_cpu_limit
WEB_MEMORY_LIMIT=$web_memory_limit
WEB_CPU_LIMIT=$web_cpu_limit
SERVER_DOTNET_GC_HEAP_HARD_LIMIT_PERCENT=$server_gc_heap_hard_limit_percent
SERVER_DOTNET_GC_CONSERVE_MEMORY=$server_gc_conserve_memory
EOF

echo "Wrote '$env_path'."

cat >"$env_example_path" <<EOF
PGPASSWORD=CHANGEME
NATS_PASSWORD=CHANGEME
SERVER_IMAGE=$server_image
WEB_IMAGE=$web_image
SERVER_PORT=$server_port
POSTGRES_MEMORY_LIMIT=$postgres_memory_limit
POSTGRES_CPU_LIMIT=$postgres_cpu_limit
NATS_MEMORY_LIMIT=$nats_memory_limit
NATS_CPU_LIMIT=$nats_cpu_limit
VALKEY_MEMORY_LIMIT=$valkey_memory_limit
VALKEY_CPU_LIMIT=$valkey_cpu_limit
SERVER_MEMORY_LIMIT=$server_memory_limit
SERVER_CPU_LIMIT=$server_cpu_limit
WEB_MEMORY_LIMIT=$web_memory_limit
WEB_CPU_LIMIT=$web_cpu_limit
SERVER_DOTNET_GC_HEAP_HARD_LIMIT_PERCENT=$server_gc_heap_hard_limit_percent
SERVER_DOTNET_GC_CONSERVE_MEMORY=$server_gc_conserve_memory
EOF

echo "Wrote '$env_example_path'."
