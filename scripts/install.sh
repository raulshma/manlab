#!/usr/bin/env bash
set -euo pipefail

# ManLab Agent installer (Linux)
#
# Example:
#   curl -fsSL http://manlab-server:5247/install.sh | sudo bash -s -- --server http://manlab-server:5247 --token "..."
#
# This script:
#   - detects RID (linux-x64/linux-arm64)
#   - downloads the staged agent binary from /api/binaries/agent/{rid}
#   - writes /etc/manlab-agent.env with MANLAB_SERVER_URL + MANLAB_AUTH_TOKEN
#   - registers and starts a systemd service

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<'EOF'
ManLab Agent installer (Linux)

Usage:
  install.sh --server <http(s)://host:port> [--token <token>] [--install-dir <dir>] [--rid <rid>] [--force]
  install.sh --uninstall [--install-dir <dir>]

Options:
  --server        Base URL to ManLab Server (e.g. http://localhost:5247)
  --token         Optional auth token (MANLAB_AUTH_TOKEN)
  --install-dir   Install directory (default: /opt/manlab-agent)
  --rid           Override runtime identifier (default: auto-detected)
  --force         Overwrite existing files and reinstall service
  --uninstall     Stop/disable the agent and remove installed files
  -h, --help      Show help

Notes:
  - ServerUrl passed to the agent is "<server>/hubs/agent".
  - Requires systemd.
EOF
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "ERROR: Required command not found: $1" >&2
    exit 1
  }
}

require_root() {
  if [[ "$(id -u)" -ne 0 ]]; then
    echo "ERROR: This installer must be run as root (use sudo)." >&2
    exit 1
  fi
}

trim_trailing_slash() {
  local s="$1"
  while [[ "$s" == */ ]]; do s="${s%/}"; done
  printf '%s' "$s"
}

detect_rid() {
  local os
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  if [[ "$os" != "linux" ]]; then
    echo "ERROR: Unsupported OS: $os" >&2
    exit 1
  fi

  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) echo "linux-x64" ;;
    aarch64|arm64) echo "linux-arm64" ;;
    *)
      echo "ERROR: Unsupported architecture: $arch" >&2
      exit 1
      ;;
  esac
}

download() {
  local url="$1"
  local out="$2"

  if command -v curl >/dev/null 2>&1; then
    curl -fLsS "$url" -o "$out"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$out" "$url"
  else
    echo "ERROR: Need curl or wget to download files." >&2
    exit 1
  fi
}

backup_file() {
  local path="$1"
  if [[ -f "$path" ]]; then
    local ts
    ts="$(date +%Y%m%d%H%M%S 2>/dev/null || true)"
    if [[ -z "$ts" ]]; then ts="backup"; fi
    cp -f "$path" "${path}.bak.${ts}" || true
  fi
}

write_minimal_appsettings() {
  local path="$1"
  local hub_url="$2"
  local token="$3"

  cat > "$path" <<EOF
{
  "Agent": {
    "ServerUrl": "${hub_url}",
    "AuthToken": "${token}",
    "HeartbeatIntervalSeconds": 10,
    "MaxReconnectDelaySeconds": 120
  }
}
EOF
}

update_appsettings_json() {
  local path="$1"
  local hub_url="$2"
  local token="$3"

  # Prefer python3 for robust JSON editing.
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$path" "$hub_url" "$token" <<'PY'
import json
import os
import sys

path, hub_url, token = sys.argv[1], sys.argv[2], sys.argv[3]

data = {}
if os.path.exists(path):
    try:
        with open(path, 'r', encoding='utf-8') as f:
            raw = f.read().strip()
            if raw:
                data = json.loads(raw)
    except Exception:
        data = {}

if not isinstance(data, dict):
    data = {}

agent = data.get('Agent')
if not isinstance(agent, dict):
    agent = {}

agent['ServerUrl'] = hub_url
if token is not None and str(token).strip() != "":
    agent['AuthToken'] = token

data['Agent'] = agent

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
    return 0
  fi

  # Fall back to node if present.
  if command -v node >/dev/null 2>&1; then
    node - <<'JS' "$path" "$hub_url" "$token"
const fs = require('fs');
const path = process.argv[2];
const hubUrl = process.argv[3];
const token = process.argv[4];

let data = {};
try {
  if (fs.existsSync(path)) {
    const raw = fs.readFileSync(path, 'utf8').trim();
    if (raw) data = JSON.parse(raw);
  }
} catch {
  data = {};
}

if (typeof data !== 'object' || data === null || Array.isArray(data)) data = {};
let agent = data.Agent;
if (typeof agent !== 'object' || agent === null || Array.isArray(agent)) agent = {};

agent.ServerUrl = hubUrl;
if (token && token.trim()) agent.AuthToken = token;
data.Agent = agent;

fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n", 'utf8');
JS
    return 0
  fi

  # Last resort: overwrite with a minimal file.
  return 1
}

SERVER=""
TOKEN=""
INSTALL_DIR="/opt/manlab-agent"
RID=""
FORCE=0
UNINSTALL=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --server)
      SERVER="${2:-}"; shift 2 ;;
    --token)
      TOKEN="${2:-}"; shift 2 ;;
    --install-dir)
      INSTALL_DIR="${2:-}"; shift 2 ;;
    --rid)
      RID="${2:-}"; shift 2 ;;
    --force)
      FORCE=1; shift 1 ;;
    --uninstall)
      UNINSTALL=1; shift 1 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

# Support non-interactive config via environment variables as well.
# (Useful for SSH bootstrap flows where passing args may be cumbersome.)
if [[ -z "$SERVER" ]]; then
  SERVER="${MANLAB_SERVER_BASE_URL:-${MANLAB_SERVER:-}}"
fi

if [[ -z "$TOKEN" ]]; then
  # Accept either an explicit enrollment token variable or the generic auth token.
  TOKEN="${MANLAB_ENROLLMENT_TOKEN:-${MANLAB_AUTH_TOKEN:-}}"
fi

require_root
need_cmd uname
need_cmd id
need_cmd mkdir
need_cmd chmod
need_cmd systemctl
need_cmd tee
need_cmd rm
need_cmd cp
need_cmd mktemp

# Uninstall mode does not require server/token.
if [[ $UNINSTALL -eq 1 ]]; then
  SERVICE_NAME="manlab-agent"
  ENV_FILE="/etc/manlab-agent.env"
  UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

  if ! systemctl list-unit-files >/dev/null 2>&1; then
    echo "ERROR: systemd does not appear to be available on this system." >&2
    exit 1
  fi

  echo "Uninstalling ManLab Agent"
  echo "  Service:     $SERVICE_NAME"
  echo "  Install dir: $INSTALL_DIR"

  # Best-effort: stop/disable service if it exists.
  systemctl stop "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl disable "$SERVICE_NAME" >/dev/null 2>&1 || true

  # Remove unit + env.
  rm -f "$UNIT_FILE" || true
  rm -f "$ENV_FILE" || true
  systemctl daemon-reload || true

  # Remove installation directory.
  if [[ -n "$INSTALL_DIR" && "$INSTALL_DIR" != "/" ]]; then
    rm -rf "$INSTALL_DIR" || true
  fi

  echo "Uninstall complete."
  exit 0
fi

if [[ -z "$SERVER" ]]; then
  echo "ERROR: --server is required (or set MANLAB_SERVER_BASE_URL / MANLAB_SERVER)." >&2
  usage
  exit 1
fi

SERVER="$(trim_trailing_slash "$SERVER")"
HUB_URL="$SERVER/hubs/agent"

if [[ -z "$RID" ]]; then
  RID="$(detect_rid)"
fi

API_BASE="$SERVER/api/binaries"
BIN_URL="$API_BASE/agent/$RID"
APPSETTINGS_URL="$API_BASE/agent/$RID/appsettings.json"

BIN_NAME="manlab-agent"
SERVICE_NAME="manlab-agent"
ENV_FILE="/etc/manlab-agent.env"
UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

if ! systemctl list-unit-files >/dev/null 2>&1; then
  echo "ERROR: systemd does not appear to be available on this system." >&2
  exit 1
fi

echo "Installing ManLab Agent"
echo "  Server:      $SERVER"
echo "  Hub URL:     $HUB_URL"
echo "  RID:         $RID"
echo "  Install dir: $INSTALL_DIR"

# Create a dedicated user if possible.
AGENT_USER="manlab-agent"
if ! id "$AGENT_USER" >/dev/null 2>&1; then
  if command -v useradd >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin "$AGENT_USER" || true
  elif command -v adduser >/dev/null 2>&1; then
    adduser --system --no-create-home --disabled-login "$AGENT_USER" || true
  fi
fi

TMP_DIR="$(mktemp -d)"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

TMP_BIN="$TMP_DIR/$BIN_NAME"
TMP_APPSETTINGS="$TMP_DIR/appsettings.json"

echo "Downloading agent binary: $BIN_URL"
download "$BIN_URL" "$TMP_BIN"

echo "Downloading appsettings.json: $APPSETTINGS_URL"
# appsettings.json is optional; if not staged the server will return 404.
if download "$APPSETTINGS_URL" "$TMP_APPSETTINGS"; then
  :
else
  echo "Warning: appsettings.json not found on server for $RID (continuing)." >&2
  rm -f "$TMP_APPSETTINGS" || true
fi

mkdir -p "$INSTALL_DIR"

if [[ -f "$INSTALL_DIR/$BIN_NAME" && $FORCE -ne 1 ]]; then
  echo "ERROR: $INSTALL_DIR/$BIN_NAME already exists. Re-run with --force to overwrite." >&2
  exit 1
fi

cp -f "$TMP_BIN" "$INSTALL_DIR/$BIN_NAME"
chmod 0755 "$INSTALL_DIR/$BIN_NAME"

if [[ -f "$TMP_APPSETTINGS" ]]; then
  if [[ -f "$INSTALL_DIR/appsettings.json" && $FORCE -ne 1 ]]; then
    echo "Note: $INSTALL_DIR/appsettings.json already exists; leaving it as-is (use --force to overwrite)."
  else
    cp -f "$TMP_APPSETTINGS" "$INSTALL_DIR/appsettings.json"
  fi
fi

# Persist hub URL + auth token in the installed appsettings.json so the agent can
# authorize on restart even if it is launched without environment variables.
APPSETTINGS_PATH="$INSTALL_DIR/appsettings.json"
if [[ ! -f "$APPSETTINGS_PATH" ]]; then
  # Ensure file exists so we can edit it.
  write_minimal_appsettings "$APPSETTINGS_PATH" "$HUB_URL" "$TOKEN"
else
  if update_appsettings_json "$APPSETTINGS_PATH" "$HUB_URL" "$TOKEN"; then
    :
  else
    echo "Warning: Could not JSON-edit existing appsettings.json (missing python3/node). Overwriting with a minimal config and creating a backup." >&2
    backup_file "$APPSETTINGS_PATH"
    write_minimal_appsettings "$APPSETTINGS_PATH" "$HUB_URL" "$TOKEN"
  fi
fi

# If we created a dedicated user, lock down appsettings.json to that user.
if id "$AGENT_USER" >/dev/null 2>&1; then
  chown "$AGENT_USER:$AGENT_USER" "$APPSETTINGS_PATH" || true
  chmod 0600 "$APPSETTINGS_PATH" || true
else
  chmod 0644 "$APPSETTINGS_PATH" || true
fi

# Write environment file.
# systemd EnvironmentFile expects KEY=VALUE lines.
{
  echo "MANLAB_SERVER_URL=$HUB_URL"
  if [[ -n "$TOKEN" ]]; then
    echo "MANLAB_AUTH_TOKEN=$TOKEN"
  fi
} | tee "$ENV_FILE" >/dev/null
chmod 0600 "$ENV_FILE"

# Write systemd unit.
# Use the dedicated user if it exists; otherwise it will run as root.
UNIT_USER_DIRECTIVE=""
if id "$AGENT_USER" >/dev/null 2>&1; then
  UNIT_USER_DIRECTIVE="User=$AGENT_USER"
fi

cat > "$UNIT_FILE" <<EOF
[Unit]
Description=ManLab Agent
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
ExecStart=$INSTALL_DIR/$BIN_NAME
Restart=always
RestartSec=5
$UNIT_USER_DIRECTIVE
EnvironmentFile=$ENV_FILE

# Hardening (best-effort; may vary by distro)
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable "$SERVICE_NAME" >/dev/null
systemctl restart "$SERVICE_NAME"

echo "Installed and started: $SERVICE_NAME"
echo "Check status with: systemctl status $SERVICE_NAME"
