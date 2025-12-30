#!/usr/bin/env bash
set -euo pipefail

# ManLab Agent installer (Linux + macOS)
#
# Example:
#   curl -fsSL http://manlab-server:5247/install.sh | sudo bash -s -- --server http://manlab-server:5247 --token "..."
#
# This script:
#   - detects RID (linux-x64/linux-arm64/osx-x64/osx-arm64)
#   - downloads the staged agent binary from /api/binaries/agent/{rid}
#   - updates appsettings.json to include the hub URL ("<server>/hubs/agent") + optional token
#   - registers and starts a background service:
#       - Linux: systemd unit + /etc/manlab-agent.env
#       - macOS: launchd plist (LaunchDaemon)

SCRIPT_NAME="$(basename "$0")"

usage() {
  cat <<'EOF'
ManLab Agent installer (Linux/macOS)

Usage:
  install.sh --server <http(s)://host:port> [--token <token>] [--install-dir <dir>] [--rid <rid>] [--force]
             [--prefer-github --github-release-base-url <url> --github-version <tag>] [--run-as-root]
             [--enable-log-viewer] [--enable-scripts] [--enable-terminal] [--enable-file-browser]
  install.sh --uninstall [--install-dir <dir>]
  install.sh --preview-uninstall [--install-dir <dir>]

Options:
  --server        Base URL to ManLab Server (e.g. http://localhost:5247)
  --token         Optional auth token (MANLAB_AUTH_TOKEN)
  --install-dir   Install directory (default: /opt/manlab-agent)
  --rid           Override runtime identifier (default: auto-detected)
  --force         Overwrite existing files and reinstall service
  --prefer-github Prefer downloading the agent binary from GitHub Releases
  --github-release-base-url  Base URL like https://github.com/owner/repo/releases/download
  --github-version           Version tag like v0.0.1-alpha
  --run-as-root   Run the agent as root (required for system updates without passwordless sudo)
  --uninstall     Stop/disable the agent and remove installed files
  --preview-uninstall  Print JSON describing what would be removed (no changes)
  
  Remote Tools (security-sensitive, default-deny):
  --enable-log-viewer    Enable remote log viewer commands
  --enable-scripts       Enable remote script execution
  --enable-terminal      Enable remote terminal access
  --enable-file-browser  Enable remote file browser
  
  Telemetry Settings (default: enabled):
  --enable-network-telemetry   Enable/disable network throughput telemetry (true/false)
  --enable-ping-telemetry      Enable/disable ping-based connectivity telemetry (true/false)
  --enable-gpu-telemetry       Enable/disable GPU telemetry (true/false)
  --enable-ups-telemetry       Enable/disable UPS telemetry (true/false)

  -h, --help      Show help

Notes:
  - ServerUrl passed to the agent is "<server>/hubs/agent".
  - Requires systemd on Linux or launchd on macOS.
  - You can also set env vars instead of flags:
      MANLAB_PREFER_GITHUB_DOWNLOAD=1
      MANLAB_GITHUB_RELEASE_BASE_URL=...
      MANLAB_GITHUB_VERSION=...
  - By default, the agent runs as a dedicated 'manlab-agent' user for security.
    Use --run-as-root to run as root (enables system updates, service management, etc.).
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

detect_os() {
  local os
  os="$(uname -s | tr '[:upper:]' '[:lower:]')"
  case "$os" in
    linux) echo "linux" ;;
    darwin) echo "darwin" ;;
    *)
      echo "ERROR: Unsupported OS: $os" >&2
      exit 1
      ;;
  esac
}

trim_trailing_slash() {
  local s="$1"
  while [[ "$s" == */ ]]; do s="${s%/}"; done
  printf '%s' "$s"
}

detect_rid() {
  local os_prefix=""
  local os
  os="$(detect_os)"
  case "$os" in
    linux) os_prefix="linux" ;;
    darwin) os_prefix="osx" ;;
  esac

  local arch
  arch="$(uname -m)"
  case "$arch" in
    x86_64|amd64) echo "${os_prefix}-x64" ;;
    aarch64|arm64) echo "${os_prefix}-arm64" ;;
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

get_github_release_info() {
  local server_url="$1"
  local info_url="${server_url}/api/binaries/agent/github-release-info"
  
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$info_url" --connect-timeout 10 2>/dev/null || echo ""
  elif command -v wget >/dev/null 2>&1; then
    wget -qO- "$info_url" --timeout=10 2>/dev/null || echo ""
  else
    echo ""
  fi
}

try_download_from_github() {
  local server_url="$1"
  local rid="$2"
  local out="$3"

  # Explicit override (flags/env) takes precedence.
  local prefer_override="${PREFER_GITHUB:-}"
  local override_base="${GITHUB_RELEASE_BASE_URL:-}"
  local override_version="${GITHUB_VERSION:-}"

  if [[ -z "$prefer_override" && -n "${MANLAB_PREFER_GITHUB_DOWNLOAD:-}" ]]; then
    prefer_override="${MANLAB_PREFER_GITHUB_DOWNLOAD}"
  fi
  if [[ -z "$override_base" && -n "${MANLAB_GITHUB_RELEASE_BASE_URL:-}" ]]; then
    override_base="${MANLAB_GITHUB_RELEASE_BASE_URL}"
  fi
  if [[ -z "$override_version" && -n "${MANLAB_GITHUB_VERSION:-}" ]]; then
    override_version="${MANLAB_GITHUB_VERSION}"
  fi

  local prefer_is_true=0
  if [[ "$prefer_override" == "1" || "$prefer_override" == "true" || "$prefer_override" == "True" ]]; then
    prefer_is_true=1
  fi

  if [[ $prefer_is_true -eq 1 && -n "$override_base" && -n "$override_version" ]]; then
    local archive_url
    archive_url="${override_base%/}/${override_version}/manlab-agent-${rid}.tar.gz"
    local binary_name="manlab-agent"

    echo "Attempting download from GitHub release: $archive_url"
    local temp_dir
    temp_dir="$(mktemp -d)"
    local archive_path="$temp_dir/agent-archive.tar.gz"

    if download "$archive_url" "$archive_path"; then
      echo "  Extracting archive..."
      if tar -xzf "$archive_path" -C "$temp_dir"; then
        local extracted_binary
        extracted_binary="$(find "$temp_dir" -type f -name "$binary_name" -print -quit 2>/dev/null || true)"
        if [[ -n "$extracted_binary" && -f "$extracted_binary" ]]; then
          cp -f "$extracted_binary" "$out"
          chmod +x "$out"
          rm -rf "$temp_dir"
          echo "  Downloaded and extracted from GitHub successfully"
          return 0
        else
          echo "  Binary '$binary_name' not found in extracted archive" >&2
        fi
      else
        echo "  Failed to extract archive" >&2
      fi
    fi

    rm -rf "$temp_dir"
    echo "  GitHub download failed, falling back to server..." >&2
    return 1
  fi
  
  local release_info
  release_info="$(get_github_release_info "$server_url")"
  
  if [[ -z "$release_info" ]]; then
    return 1
  fi
  
  # Parse JSON with python3 if available, otherwise jq
  local enabled=""
  local archive_url=""
  local binary_name=""
  
  if command -v python3 >/dev/null 2>&1; then
    enabled=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print('true' if d.get('enabled') else 'false')" <<< "$release_info" 2>/dev/null || echo "false")
    archive_url=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); urls=d.get('downloadUrls',{}); r=urls.get('$rid',{}); print(r.get('archiveUrl',''))" <<< "$release_info" 2>/dev/null || echo "")
    binary_name=$(python3 -c "import json,sys; d=json.loads(sys.stdin.read()); urls=d.get('downloadUrls',{}); r=urls.get('$rid',{}); print(r.get('binaryName','manlab-agent'))" <<< "$release_info" 2>/dev/null || echo "manlab-agent")
  elif command -v jq >/dev/null 2>&1; then
    enabled=$(echo "$release_info" | jq -r '.enabled // false' 2>/dev/null || echo "false")
    archive_url=$(echo "$release_info" | jq -r ".downloadUrls.\"$rid\".archiveUrl // \"\"" 2>/dev/null || echo "")
    binary_name=$(echo "$release_info" | jq -r ".downloadUrls.\"$rid\".binaryName // \"manlab-agent\"" 2>/dev/null || echo "manlab-agent")
  else
    # No JSON parser available
    return 1
  fi
  
  if [[ "$enabled" != "true" ]] || [[ -z "$archive_url" ]]; then
    return 1
  fi
  
  # GitHub releases contain archives (.tar.gz for Linux/macOS), so we download and extract
  echo "Attempting download from GitHub release: $archive_url"
  local temp_dir
  temp_dir="$(mktemp -d)"
  local archive_path="$temp_dir/agent-archive.tar.gz"
  
  if download "$archive_url" "$archive_path"; then
    echo "  Extracting archive..."
    if tar -xzf "$archive_path" -C "$temp_dir"; then
      local extracted_binary
      extracted_binary="$(find "$temp_dir" -type f -name "$binary_name" -print -quit 2>/dev/null || true)"
      if [[ -n "$extracted_binary" && -f "$extracted_binary" ]]; then
        cp -f "$extracted_binary" "$out"
        chmod +x "$out"
        rm -rf "$temp_dir"
        echo "  Downloaded and extracted from GitHub successfully"
        return 0
      else
        echo "  Binary '$binary_name' not found in extracted archive" >&2
      fi
    else
      echo "  Failed to extract archive" >&2
    fi
    rm -rf "$temp_dir"
  fi
  
  echo "  GitHub download failed, falling back to server..." >&2
  return 1
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
  # Additional settings passed as env vars: ENABLE_LOG_VIEWER, ENABLE_SCRIPTS, etc.

  # Build the Agent section with all settings
  local agent_section=""
  agent_section+="\"ServerUrl\": \"${hub_url}\","
  agent_section+="\"AuthToken\": \"${token}\","
  agent_section+="\"HeartbeatIntervalSeconds\": 10,"
  agent_section+="\"MaxReconnectDelaySeconds\": 120"

  # Add remote tool settings if explicitly enabled
  if [[ $ENABLE_LOG_VIEWER -eq 1 ]]; then agent_section+=",\"EnableLogViewer\": true"; fi
  if [[ $ENABLE_SCRIPTS -eq 1 ]]; then agent_section+=",\"EnableScripts\": true"; fi
  if [[ $ENABLE_TERMINAL -eq 1 ]]; then agent_section+=",\"EnableTerminal\": true"; fi
  if [[ $ENABLE_FILE_BROWSER -eq 1 ]]; then agent_section+=",\"EnableFileBrowser\": true"; fi

  # Add telemetry settings only if explicitly set
  if [[ -n "$ENABLE_NETWORK_TELEMETRY" ]]; then
    if [[ "$ENABLE_NETWORK_TELEMETRY" == "true" ]]; then
      agent_section+=",\"EnableNetworkTelemetry\": true"
    else
      agent_section+=",\"EnableNetworkTelemetry\": false"
    fi
  fi
  if [[ -n "$ENABLE_PING_TELEMETRY" ]]; then
    if [[ "$ENABLE_PING_TELEMETRY" == "true" ]]; then
      agent_section+=",\"EnablePingTelemetry\": true"
    else
      agent_section+=",\"EnablePingTelemetry\": false"
    fi
  fi
  if [[ -n "$ENABLE_GPU_TELEMETRY" ]]; then
    if [[ "$ENABLE_GPU_TELEMETRY" == "true" ]]; then
      agent_section+=",\"EnableGpuTelemetry\": true"
    else
      agent_section+=",\"EnableGpuTelemetry\": false"
    fi
  fi
  if [[ -n "$ENABLE_UPS_TELEMETRY" ]]; then
    if [[ "$ENABLE_UPS_TELEMETRY" == "true" ]]; then
      agent_section+=",\"EnableUpsTelemetry\": true"
    else
      agent_section+=",\"EnableUpsTelemetry\": false"
    fi
  fi

  cat > "$path" <<EOF
{
  "Agent": {
    ${agent_section}
  }
}
EOF
}

# Apply additional agent settings to an existing appsettings.json
# This handles remote tools and telemetry settings passed via CLI flags.
apply_agent_settings() {
  local path="$1"
  local enable_log_viewer="$2"
  local enable_scripts="$3"
  local enable_terminal="$4"
  local enable_file_browser="$5"
  local enable_network_telemetry="$6"
  local enable_ping_telemetry="$7"
  local enable_gpu_telemetry="$8"
  local enable_ups_telemetry="$9"

  # Skip if no settings to apply
  if [[ "$enable_log_viewer" != "1" && "$enable_scripts" != "1" && \
        "$enable_terminal" != "1" && "$enable_file_browser" != "1" && \
        -z "$enable_network_telemetry" && -z "$enable_ping_telemetry" && \
        -z "$enable_gpu_telemetry" && -z "$enable_ups_telemetry" ]]; then
    return 0
  fi

  # Use python3 for robust JSON editing
  if command -v python3 >/dev/null 2>&1; then
    python3 - "$path" "$enable_log_viewer" "$enable_scripts" "$enable_terminal" "$enable_file_browser" \
              "$enable_network_telemetry" "$enable_ping_telemetry" "$enable_gpu_telemetry" "$enable_ups_telemetry" <<'PY'
import json
import os
import sys

path = sys.argv[1]
enable_log_viewer = sys.argv[2] == "1"
enable_scripts = sys.argv[3] == "1"
enable_terminal = sys.argv[4] == "1"
enable_file_browser = sys.argv[5] == "1"
enable_network_telemetry = sys.argv[6] if len(sys.argv) > 6 else ""
enable_ping_telemetry = sys.argv[7] if len(sys.argv) > 7 else ""
enable_gpu_telemetry = sys.argv[8] if len(sys.argv) > 8 else ""
enable_ups_telemetry = sys.argv[9] if len(sys.argv) > 9 else ""

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

# Remote tools (only set if explicitly enabled)
if enable_log_viewer:
    agent['EnableLogViewer'] = True
if enable_scripts:
    agent['EnableScripts'] = True
if enable_terminal:
    agent['EnableTerminal'] = True
if enable_file_browser:
    agent['EnableFileBrowser'] = True

# Telemetry settings (only override if explicitly set)
def parse_bool(s):
    if s.lower() in ('true', '1', 'yes'):
        return True
    elif s.lower() in ('false', '0', 'no'):
        return False
    return None

if enable_network_telemetry:
    val = parse_bool(enable_network_telemetry)
    if val is not None:
        agent['EnableNetworkTelemetry'] = val

if enable_ping_telemetry:
    val = parse_bool(enable_ping_telemetry)
    if val is not None:
        agent['EnablePingTelemetry'] = val

if enable_gpu_telemetry:
    val = parse_bool(enable_gpu_telemetry)
    if val is not None:
        agent['EnableGpuTelemetry'] = val

if enable_ups_telemetry:
    val = parse_bool(enable_ups_telemetry)
    if val is not None:
        agent['EnableUpsTelemetry'] = val

data['Agent'] = agent

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
    f.write("\n")
PY
    return $?
  fi

  # Fallback to node.js
  if command -v node >/dev/null 2>&1; then
    node - <<'JS' "$path" "$enable_log_viewer" "$enable_scripts" "$enable_terminal" "$enable_file_browser" \
              "$enable_network_telemetry" "$enable_ping_telemetry" "$enable_gpu_telemetry" "$enable_ups_telemetry"
const fs = require('fs');
const path = process.argv[2];
const enableLogViewer = process.argv[3] === "1";
const enableScripts = process.argv[4] === "1";
const enableTerminal = process.argv[5] === "1";
const enableFileBrowser = process.argv[6] === "1";
const enableNetworkTelemetry = process.argv[7] || "";
const enablePingTelemetry = process.argv[8] || "";
const enableGpuTelemetry = process.argv[9] || "";
const enableUpsTelemetry = process.argv[10] || "";

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

// Remote tools
if (enableLogViewer) agent.EnableLogViewer = true;
if (enableScripts) agent.EnableScripts = true;
if (enableTerminal) agent.EnableTerminal = true;
if (enableFileBrowser) agent.EnableFileBrowser = true;

// Telemetry
const parseBool = (s) => {
  if (['true', '1', 'yes'].includes(s.toLowerCase())) return true;
  if (['false', '0', 'no'].includes(s.toLowerCase())) return false;
  return null;
};

if (enableNetworkTelemetry) {
  const val = parseBool(enableNetworkTelemetry);
  if (val !== null) agent.EnableNetworkTelemetry = val;
}
if (enablePingTelemetry) {
  const val = parseBool(enablePingTelemetry);
  if (val !== null) agent.EnablePingTelemetry = val;
}
if (enableGpuTelemetry) {
  const val = parseBool(enableGpuTelemetry);
  if (val !== null) agent.EnableGpuTelemetry = val;
}
if (enableUpsTelemetry) {
  const val = parseBool(enableUpsTelemetry);
  if (val !== null) agent.EnableUpsTelemetry = val;
}

data.Agent = agent;
fs.writeFileSync(path, JSON.stringify(data, null, 2) + "\n", 'utf8');
JS
    return $?
  fi

  # No JSON editor available; settings not applied (file already has server defaults)
  echo "Warning: Could not apply CLI settings to appsettings.json (missing python3/node). Server defaults will be used." >&2
  return 0
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
PREVIEW_UNINSTALL=0
PREFER_GITHUB=""
GITHUB_RELEASE_BASE_URL=""
GITHUB_VERSION=""
RUN_AS_ROOT=0

# Remote tools (security-sensitive, default-deny)
ENABLE_LOG_VIEWER=0
ENABLE_SCRIPTS=0
ENABLE_TERMINAL=0
ENABLE_FILE_BROWSER=0

# Telemetry settings (default: enabled, empty means use default)
ENABLE_NETWORK_TELEMETRY=""
ENABLE_PING_TELEMETRY=""
ENABLE_GPU_TELEMETRY=""
ENABLE_UPS_TELEMETRY=""

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
    --prefer-github)
      PREFER_GITHUB="1"; shift 1 ;;
    --github-release-base-url)
      GITHUB_RELEASE_BASE_URL="${2:-}"; shift 2 ;;
    --github-version)
      GITHUB_VERSION="${2:-}"; shift 2 ;;
    --run-as-root)
      RUN_AS_ROOT=1; shift 1 ;;
    --enable-log-viewer)
      ENABLE_LOG_VIEWER=1; shift 1 ;;
    --enable-scripts)
      ENABLE_SCRIPTS=1; shift 1 ;;
    --enable-terminal)
      ENABLE_TERMINAL=1; shift 1 ;;
    --enable-file-browser)
      ENABLE_FILE_BROWSER=1; shift 1 ;;
    --enable-network-telemetry)
      ENABLE_NETWORK_TELEMETRY="${2:-true}"; shift 2 ;;
    --enable-ping-telemetry)
      ENABLE_PING_TELEMETRY="${2:-true}"; shift 2 ;;
    --enable-gpu-telemetry)
      ENABLE_GPU_TELEMETRY="${2:-true}"; shift 2 ;;
    --enable-ups-telemetry)
      ENABLE_UPS_TELEMETRY="${2:-true}"; shift 2 ;;
    --uninstall)
      UNINSTALL=1; shift 1 ;;
    --preview-uninstall)
      PREVIEW_UNINSTALL=1; shift 1 ;;
    -h|--help)
      usage; exit 0 ;;
    *)
      echo "ERROR: Unknown argument: $1" >&2
      usage
      exit 1
      ;;
  esac
done

json_escape() {
  # Best-effort JSON string escaping.
  # shellcheck disable=SC2001
  echo -n "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/\t/\\t/g' -e 's/\r/\\r/g' -e 's/\n/\\n/g'
}

json_array() {
  # Args are items.
  local first=1
  echo -n "["
  for item in "$@"; do
    if [[ $first -eq 0 ]]; then echo -n ","; fi
    first=0
    echo -n "\"$(json_escape "$item")\""
  done
  echo -n "]"
}

preview_uninstall() {
  local os_kind
  os_kind="$(detect_os)"

  local sections=""
  local notes=()

  add_section() {
    local label="$1"; shift
    local items=("$@")
    local section
    section="{\"label\":\"$(json_escape "$label")\",\"items\":$(json_array "${items[@]}")}" 
    if [[ -z "$sections" ]]; then
      sections="$section"
    else
      sections+=" ,$section"
    fi
  }

  if [[ "$os_kind" == "linux" ]]; then
    local service_name="manlab-agent"

    local units=()
    if command -v systemctl >/dev/null 2>&1; then
      while IFS= read -r u; do
        [[ -n "$u" ]] && units+=("$u")
      done < <(systemctl list-unit-files 2>/dev/null | awk '{print $1}' | grep -E '^manlab-agent.*\.service$' || true)
    else
      notes+=("systemctl not found; systemd inventory unavailable")
    fi
    if [[ ${#units[@]} -eq 0 ]]; then
      units+=("${service_name}.service (if present)")
    fi
    add_section "Systemd units" "${units[@]}"

    local unit_files=()
    for f in "/etc/systemd/system/${service_name}.service" "/lib/systemd/system/${service_name}.service" "/usr/lib/systemd/system/${service_name}.service"; do
      if [[ -f "$f" ]]; then unit_files+=("$f"); fi
    done
    if [[ ${#unit_files[@]} -eq 0 ]]; then
      unit_files+=("/etc/systemd/system/${service_name}.service")
      unit_files+=("/lib/systemd/system/${service_name}.service")
      unit_files+=("/usr/lib/systemd/system/${service_name}.service")
    fi
    add_section "Unit files" "${unit_files[@]}"

    local config_files=()
    for f in "/etc/manlab-agent.env" "/etc/default/${service_name}" "/etc/sysconfig/${service_name}"; do
      if [[ -f "$f" ]]; then config_files+=("$f"); fi
    done
    if [[ ${#config_files[@]} -eq 0 ]]; then
      config_files+=("/etc/manlab-agent.env")
      config_files+=("/etc/default/${service_name} (if present)")
      config_files+=("/etc/sysconfig/${service_name} (if present)")
    fi
    add_section "Config files" "${config_files[@]}"

    local dirs=()
    for d in "$INSTALL_DIR" "/opt/manlab-agent"; do
      if [[ -d "$d" ]]; then dirs+=("$d"); fi
    done
    if [[ ${#dirs[@]} -eq 0 ]]; then
      dirs+=("$INSTALL_DIR")
      [[ "$INSTALL_DIR" != "/opt/manlab-agent" ]] && dirs+=("/opt/manlab-agent")
    fi
    add_section "Directories" "${dirs[@]}"

    # Sample files
    for d in "${dirs[@]}"; do
      if [[ -d "$d" ]]; then
        local files=()
        while IFS= read -r f; do
          [[ -n "$f" ]] && files+=("$f")
        done < <(find "$d" -type f -maxdepth 3 2>/dev/null | head -n 20 || true)
        if [[ ${#files[@]} -gt 0 ]]; then
          add_section "Files (sample) — $d" "${files[@]}"
        fi
      fi
    done

    if [[ "$(id -u)" != "0" ]]; then
      notes+=("Preview collected without root; some resources may not be visible")
    fi
  else
    # macOS
    local plist_name="com.manlab.agent"
    local plist_daemon="/Library/LaunchDaemons/${plist_name}.plist"
    local plist_agent="/Library/LaunchAgents/${plist_name}.plist"

    local launchd_items=()
    launchd_items+=("Label: ${plist_name}")
    if [[ -f "$plist_daemon" ]]; then launchd_items+=("$plist_daemon"); else launchd_items+=("$plist_daemon (if present)"); fi
    if [[ -f "$plist_agent" ]]; then launchd_items+=("$plist_agent"); else launchd_items+=("$plist_agent (if present)"); fi
    add_section "launchd" "${launchd_items[@]}"

    local dirs=()
    for d in "$INSTALL_DIR" "/opt/manlab-agent"; do
      if [[ -d "$d" ]]; then dirs+=("$d"); fi
    done
    if [[ ${#dirs[@]} -eq 0 ]]; then
      dirs+=("$INSTALL_DIR")
      [[ "$INSTALL_DIR" != "/opt/manlab-agent" ]] && dirs+=("/opt/manlab-agent")
    fi
    add_section "Directories" "${dirs[@]}"

    for d in "${dirs[@]}"; do
      if [[ -d "$d" ]]; then
        local files=()
        while IFS= read -r f; do
          [[ -n "$f" ]] && files+=("$f")
        done < <(find "$d" -type f -maxdepth 3 2>/dev/null | head -n 20 || true)
        if [[ ${#files[@]} -gt 0 ]]; then
          add_section "Files (sample) — $d" "${files[@]}"
        fi
      fi
    done

    if [[ "$(id -u)" != "0" ]]; then
      notes+=("Preview collected without root; some resources may not be visible")
    fi
  fi

  local notes_json
  notes_json=$(json_array "${notes[@]}")
  printf '{"success":true,"osHint":"%s","sections":[%s],"notes":%s,"error":null}\n' "$(json_escape "${os_kind^}")" "$sections" "$notes_json"
}

# Support non-interactive config via environment variables as well.
# (Useful for SSH bootstrap flows where passing args may be cumbersome.)
if [[ -z "$SERVER" ]]; then
  SERVER="${MANLAB_SERVER_BASE_URL:-${MANLAB_SERVER:-}}"
fi

if [[ -z "$TOKEN" ]]; then
  # Accept either an explicit enrollment token variable or the generic auth token.
  TOKEN="${MANLAB_ENROLLMENT_TOKEN:-${MANLAB_AUTH_TOKEN:-}}"
fi

need_cmd uname
need_cmd id
need_cmd mkdir
need_cmd chmod
need_cmd rm
need_cmd cp
need_cmd mktemp

if [[ $PREVIEW_UNINSTALL -eq 1 ]]; then
  # Preview mode should not require root; it is best-effort.
  preview_uninstall
  exit 0
fi

require_root
need_cmd tee

OS_KIND="$(detect_os)"
if [[ "$OS_KIND" == "linux" ]]; then
  need_cmd systemctl
else
  need_cmd launchctl
fi

# Uninstall mode does not require server/token.
if [[ $UNINSTALL -eq 1 ]]; then
  SERVICE_NAME="manlab-agent"
  AGENT_USER="manlab-agent"

  echo "Uninstalling ManLab Agent"
  echo "  Service:     $SERVICE_NAME"
  echo "  Install dir: $INSTALL_DIR"

  if [[ "$OS_KIND" == "linux" ]]; then
    ENV_FILE="/etc/manlab-agent.env"
    UNIT_FILE_ETC="/etc/systemd/system/${SERVICE_NAME}.service"
    UNIT_FILE_LIB="/lib/systemd/system/${SERVICE_NAME}.service"
    UNIT_FILE_USR_LIB="/usr/lib/systemd/system/${SERVICE_NAME}.service"

    if ! systemctl list-unit-files >/dev/null 2>&1; then
      echo "ERROR: systemd does not appear to be available on this system." >&2
      exit 1
    fi

    # Best-effort: stop/disable any matching unit variants.
    # Older versions or manual installs might have left different unit files behind.
    for unit in "${SERVICE_NAME}.service" "${SERVICE_NAME}"; do
      systemctl stop "$unit" >/dev/null 2>&1 || true
      systemctl disable "$unit" >/dev/null 2>&1 || true
    done

    # Also attempt to disable any unit names that start with manlab-agent (templated or suffixed).
    systemctl list-unit-files 2>/dev/null | awk '{print $1}' | grep -E '^manlab-agent.*\.service$' | while read -r unit; do
      systemctl stop "$unit" >/dev/null 2>&1 || true
      systemctl disable "$unit" >/dev/null 2>&1 || true
    done

    # Remove unit + env.
    rm -f "$UNIT_FILE_ETC" || true
    rm -f "$UNIT_FILE_LIB" || true
    rm -f "$UNIT_FILE_USR_LIB" || true
    rm -f "$ENV_FILE" || true

    # Distro-specific leftovers (best-effort)
    rm -f "/etc/default/${SERVICE_NAME}" "/etc/sysconfig/${SERVICE_NAME}" 2>/dev/null || true

    systemctl daemon-reload || true

    # Best-effort: remove the dedicated user we created during install.
    # (Do not fail uninstall if user removal isn't supported on this distro.)
    if id "$AGENT_USER" >/dev/null 2>&1; then
      if command -v pkill >/dev/null 2>&1; then
        pkill -u "$AGENT_USER" >/dev/null 2>&1 || true
      fi

      if command -v userdel >/dev/null 2>&1; then
        userdel "$AGENT_USER" >/dev/null 2>&1 || true
      elif command -v deluser >/dev/null 2>&1; then
        deluser "$AGENT_USER" >/dev/null 2>&1 || true
      fi

      if command -v groupdel >/dev/null 2>&1; then
        groupdel "$AGENT_USER" >/dev/null 2>&1 || true
      fi
    fi
  else
    PLIST_NAME="com.manlab.agent"
    PLIST_FILE="/Library/LaunchDaemons/${PLIST_NAME}.plist"

    # Also remove LaunchAgent variants if they exist (some setups use LaunchAgents).
    PLIST_FILE_AGENT="/Library/LaunchAgents/${PLIST_NAME}.plist"

    # Best-effort: unload if present.
    launchctl bootout system "$PLIST_FILE" >/dev/null 2>&1 || true
    rm -f "$PLIST_FILE" || true
    rm -f "$PLIST_FILE_AGENT" || true
  fi

  # Remove installation directory (plus common defaults as best-effort).
  # Note: we intentionally keep the directory list tight to avoid accidental deletions.
  DEFAULT_DIRS=("$INSTALL_DIR" "/opt/manlab-agent")
  for d in "${DEFAULT_DIRS[@]}"; do
    if [[ -n "$d" && "$d" != "/" && "$d" != "." ]]; then
      rm -rf "$d" 2>/dev/null || true
    fi
  done

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

echo "Installing ManLab Agent"
echo "  Server:      $SERVER"
echo "  Hub URL:     $HUB_URL"
echo "  RID:         $RID"
echo "  Install dir: $INSTALL_DIR"
if [[ $RUN_AS_ROOT -eq 1 ]]; then
  echo "  Run as:      root (system updates enabled)"
else
  echo "  Run as:      manlab-agent (dedicated user)"
fi

# Create a dedicated user if possible (unless running as root).
AGENT_USER="manlab-agent"
if [[ $RUN_AS_ROOT -eq 0 ]] && [[ "$OS_KIND" == "linux" ]] && ! id "$AGENT_USER" >/dev/null 2>&1; then
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

# Try downloading from GitHub releases first, fall back to server API
if try_download_from_github "$SERVER" "$RID" "$TMP_BIN"; then
  : # Downloaded from GitHub
else
  echo "Downloading agent binary from server: $BIN_URL"
  download "$BIN_URL" "$TMP_BIN"
fi

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

# Apply CLI-specified agent settings (remote tools, telemetry) to appsettings.json.
# These override server defaults when passed via command line.
apply_agent_settings "$APPSETTINGS_PATH" \
  "$ENABLE_LOG_VIEWER" "$ENABLE_SCRIPTS" "$ENABLE_TERMINAL" "$ENABLE_FILE_BROWSER" \
  "$ENABLE_NETWORK_TELEMETRY" "$ENABLE_PING_TELEMETRY" "$ENABLE_GPU_TELEMETRY" "$ENABLE_UPS_TELEMETRY"

# If we created a dedicated user, lock down appsettings.json to that user.
if [[ "$OS_KIND" == "linux" ]] && id "$AGENT_USER" >/dev/null 2>&1; then
  chown "$AGENT_USER:$AGENT_USER" "$APPSETTINGS_PATH" || true
  chmod 0600 "$APPSETTINGS_PATH" || true
else
  chmod 0644 "$APPSETTINGS_PATH" || true
fi

if [[ "$OS_KIND" == "linux" ]]; then
  ENV_FILE="/etc/manlab-agent.env"
  UNIT_FILE="/etc/systemd/system/${SERVICE_NAME}.service"

  if ! systemctl list-unit-files >/dev/null 2>&1; then
    echo "ERROR: systemd does not appear to be available on this system." >&2
    exit 1
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
  # Use the dedicated user unless --run-as-root was specified.
  UNIT_USER_DIRECTIVE=""
  if [[ $RUN_AS_ROOT -eq 0 ]] && id "$AGENT_USER" >/dev/null 2>&1; then
    UNIT_USER_DIRECTIVE="User=$AGENT_USER"
  elif [[ $RUN_AS_ROOT -eq 1 ]]; then
    echo "Note: Agent will run as root (--run-as-root specified)."
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
# Note: NoNewPrivileges is intentionally NOT set to allow sudo for system updates
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
else
  PLIST_NAME="com.manlab.agent"
  PLIST_FILE="/Library/LaunchDaemons/${PLIST_NAME}.plist"

  # On macOS, LaunchDaemons run as root by default. If --run-as-root is not specified,
  # we'll add a UserName key to run as a dedicated user (if we can create one).
  PLIST_USERNAME=""
  if [[ $RUN_AS_ROOT -eq 0 ]]; then
    # Try to create a dedicated user on macOS (requires admin/root)
    # Note: macOS user creation is more complex than Linux; we use dscl if available.
    if ! id "$AGENT_USER" >/dev/null 2>&1; then
      if command -v dscl >/dev/null 2>&1; then
        # Find an available UID (500+ is typically for regular users, we use 400-499 for system accounts)
        NEXT_UID=400
        while dscl . -list /Users UniqueID | awk '{print $2}' | grep -q "^${NEXT_UID}$"; do
          NEXT_UID=$((NEXT_UID + 1))
          if [[ $NEXT_UID -ge 500 ]]; then break; fi
        done

        if [[ $NEXT_UID -lt 500 ]]; then
          echo "Creating dedicated user '$AGENT_USER' on macOS (UID=$NEXT_UID)..."
          dscl . -create "/Users/$AGENT_USER" 2>/dev/null || true
          dscl . -create "/Users/$AGENT_USER" UserShell /usr/bin/false 2>/dev/null || true
          dscl . -create "/Users/$AGENT_USER" UniqueID "$NEXT_UID" 2>/dev/null || true
          dscl . -create "/Users/$AGENT_USER" PrimaryGroupID 20 2>/dev/null || true  # staff group
          dscl . -create "/Users/$AGENT_USER" RealName "ManLab Agent" 2>/dev/null || true
          dscl . -create "/Users/$AGENT_USER" IsHidden 1 2>/dev/null || true
        fi
      fi
    fi

    if id "$AGENT_USER" >/dev/null 2>&1; then
      PLIST_USERNAME="$AGENT_USER"
      chown -R "$AGENT_USER" "$INSTALL_DIR" 2>/dev/null || true
      echo "Note: Agent will run as user '$AGENT_USER' on macOS."
    else
      echo "Note: Could not create dedicated user on macOS. Agent will run as root."
    fi
  else
    echo "Note: Agent will run as root on macOS (--run-as-root specified)."
  fi

  # launchd does not support an EnvironmentFile directive like systemd.
  # Store the variables directly in the plist.
  # Note: This is comparable to /etc/manlab-agent.env on Linux in terms of sensitivity.
  TOKEN_VALUE="${TOKEN}"

  cat > "$PLIST_FILE" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${PLIST_NAME}</string>

  <key>ProgramArguments</key>
  <array>
    <string>${INSTALL_DIR}/${BIN_NAME}</string>
  </array>

  <key>WorkingDirectory</key>
  <string>${INSTALL_DIR}</string>

  <key>EnvironmentVariables</key>
  <dict>
    <key>MANLAB_SERVER_URL</key>
    <string>${HUB_URL}</string>
EOF

  if [[ -n "$TOKEN_VALUE" ]]; then
    cat >> "$PLIST_FILE" <<EOF
    <key>MANLAB_AUTH_TOKEN</key>
    <string>${TOKEN_VALUE}</string>
EOF
  fi

  cat >> "$PLIST_FILE" <<'EOF'
  </dict>

EOF

  # Add UserName key if running as dedicated user (not root)
  if [[ -n "$PLIST_USERNAME" ]]; then
    cat >> "$PLIST_FILE" <<EOF
  <key>UserName</key>
  <string>${PLIST_USERNAME}</string>

EOF
  fi

  cat >> "$PLIST_FILE" <<'EOF'
  <key>RunAtLoad</key>
  <true/>

  <key>KeepAlive</key>
  <true/>

  <key>StandardOutPath</key>
  <string>/var/log/manlab-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/var/log/manlab-agent.err.log</string>
</dict>
</plist>
EOF

  chmod 0644 "$PLIST_FILE" || true
  # Best-effort: unload any old copy, then load.
  launchctl bootout system "$PLIST_FILE" >/dev/null 2>&1 || true
  launchctl bootstrap system "$PLIST_FILE"
  launchctl enable system/$PLIST_NAME >/dev/null 2>&1 || true
  launchctl kickstart -k system/$PLIST_NAME >/dev/null 2>&1 || true

  echo "Installed and started: $PLIST_NAME"
  echo "Logs: /var/log/manlab-agent.log"
fi
