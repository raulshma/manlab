#!/usr/bin/env bash
#=============================================================================
# ManLab Agent Installer - Bootstrap Wrapper
# This wrapper downloads and executes the modular installer from the server.
# For local development, it can also source from the scripts/installer directory.
#
# Usage:
#   curl -fsSL http://manlab-server:5247/install.sh | sudo bash -s -- --server http://manlab-server:5247
#=============================================================================

set -euo pipefail

SCRIPT_NAME="$(basename "$0")"
INSTALLER_VERSION="2.0.0"

# Check if running from local installer directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || echo "")"
LOCAL_INSTALLER="$SCRIPT_DIR/installer/install.sh"

if [[ -f "$LOCAL_INSTALLER" ]]; then
    # Running from local development
    exec "$LOCAL_INSTALLER" "$@"
fi

# Otherwise, this is a piped/downloaded script - run self-contained
# Fall through to embedded installer logic...

#=============================================================================
# EMBEDDED MINIMAL INSTALLER (for piped execution)
# This is a simplified version for curl|bash workflows
#=============================================================================

# Colors
if [[ -t 1 ]]; then
    RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
else
    RED=''; GREEN=''; YELLOW=''; NC=''
fi

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

show_help() {
    cat <<'EOF'
ManLab Agent Installer (Quick Install)

Usage:
  curl -fsSL http://server/install.sh | sudo bash -s -- --server <url> [options]

Options:
  --server <url>       ManLab server URL (required)
  --token <token>      Authentication token
  --install-dir <dir>  Installation directory (default: /opt/manlab-agent)
  --force              Overwrite existing installation
  --run-as-root        Run agent as root
  --uninstall          Remove agent installation
    --agent-channel <ch>  Local distribution channel for server downloads (e.g. stable, beta)
    --agent-version <v>   Local distribution version folder (e.g. v1.2.3). Omit for staged.
    --prefer-github       Prefer downloading agent from GitHub Releases
    --github-release-base-url <url>  GitHub releases download base URL (e.g. https://github.com/<owner>/<repo>/releases/download)
    --github-version <tag>           GitHub release tag (e.g. v0.0.2-alpha)
  --help               Show this help

Remote Tools (disabled by default):
  --enable-log-viewer   --enable-scripts   --enable-terminal   --enable-file-browser

For full options, download the installer:
  curl -fsSL http://server/api/installer/bundle.tar.gz | tar xzf -
  sudo ./installer/install.sh --help
EOF
}

require_root() {
    [[ "$(id -u)" -eq 0 ]] || { log_error "Run with sudo"; exit 1; }
}

detect_rid() {
    local os arch
    os=$(uname -s | tr '[:upper:]' '[:lower:]')
    arch=$(uname -m)
    case "$os" in
        linux)  os="linux" ;;
        darwin) os="osx" ;;
        *)      log_error "Unsupported OS: $os"; exit 1 ;;
    esac
    case "$arch" in
        x86_64|amd64)  arch="x64" ;;
        aarch64|arm64) arch="arm64" ;;
        *)             log_error "Unsupported arch: $arch"; exit 1 ;;
    esac
    echo "${os}-${arch}"
}

download() {
    local url="$1" out="$2"
    if command -v curl &>/dev/null; then
        curl -fsSL --connect-timeout 30 --max-time 600 --retry 3 "$url" -o "$out"
    elif command -v wget &>/dev/null; then
        wget -q --timeout=30 --tries=3 -O "$out" "$url"
    else
        log_error "curl or wget required"; exit 1
    fi
}

download_from_github() {
    local rid="$1" out_file="$2"

    [[ "$PREFER_GITHUB" -eq 1 ]] || return 1
    [[ -n "$GITHUB_RELEASE_BASE_URL" ]] || return 1
    [[ -n "$GITHUB_VERSION" ]] || return 1

    if ! command -v tar &>/dev/null; then
        log_warn "tar not found; cannot use GitHub archive download. Falling back to server."
        return 1
    fi

    local archive_url archive_path temp_dir extracted
    archive_url="${GITHUB_RELEASE_BASE_URL%/}/${GITHUB_VERSION}/manlab-agent-${rid}.tar.gz"
    log_info "Attempting GitHub Releases download: $archive_url"

    temp_dir="$(mktemp -d)"
    archive_path="$temp_dir/agent.tar.gz"
    trap 'rm -rf "$temp_dir"' RETURN

    if ! download "$archive_url" "$archive_path"; then
        log_warn "GitHub download failed; falling back to server"
        return 1
    fi

    if ! tar -xzf "$archive_path" -C "$temp_dir"; then
        log_warn "Failed to extract GitHub archive; falling back to server"
        return 1
    fi

    extracted="$(find "$temp_dir" -type f -name 'manlab-agent' -print -quit 2>/dev/null || true)"
    if [[ -z "$extracted" || ! -f "$extracted" ]]; then
        log_warn "GitHub archive did not contain expected binary; falling back to server"
        return 1
    fi

    cp -f "$extracted" "$out_file"
    chmod +x "$out_file"
    log_info "Downloaded agent from GitHub Releases successfully"
    return 0
}

# Parse arguments
SERVER="" TOKEN="" INSTALL_DIR="/opt/manlab-agent" FORCE=0 UNINSTALL=0 RUN_AS_ROOT=0
ENABLE_LOG_VIEWER=0 ENABLE_SCRIPTS=0 ENABLE_TERMINAL=0 ENABLE_FILE_BROWSER=0
PREFER_GITHUB=0 GITHUB_RELEASE_BASE_URL="" GITHUB_VERSION=""
AGENT_CHANNEL="" AGENT_VERSION=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server)         SERVER="$2"; shift 2 ;;
        --token)          TOKEN="$2"; shift 2 ;;
        --install-dir)    INSTALL_DIR="$2"; shift 2 ;;
        --force)          FORCE=1; shift ;;
        --run-as-root)    RUN_AS_ROOT=1; shift ;;
        --agent-channel)  AGENT_CHANNEL="$2"; shift 2 ;;
        --agent-version)  AGENT_VERSION="$2"; shift 2 ;;
        --prefer-github)  PREFER_GITHUB=1; shift ;;
        --github-release-base-url) GITHUB_RELEASE_BASE_URL="$2"; shift 2 ;;
        --github-version) GITHUB_VERSION="$2"; shift 2 ;;
        --uninstall)      UNINSTALL=1; shift ;;
        --enable-log-viewer)   ENABLE_LOG_VIEWER=1; shift ;;
        --enable-scripts)      ENABLE_SCRIPTS=1; shift ;;
        --enable-terminal)     ENABLE_TERMINAL=1; shift ;;
        --enable-file-browser) ENABLE_FILE_BROWSER=1; shift ;;
        --help|-h)        show_help; exit 0 ;;
        *)                log_error "Unknown: $1"; exit 1 ;;
    esac
done

# Environment variable fallbacks
[[ -z "$SERVER" ]] && SERVER="${MANLAB_SERVER_BASE_URL:-${MANLAB_SERVER:-}}"
[[ -z "$TOKEN" ]] && TOKEN="${MANLAB_AUTH_TOKEN:-}"

# Validate
require_root

if [[ "$UNINSTALL" -eq 1 ]]; then
    log_info "Uninstalling ManLab Agent..."
    
    # Stop and disable systemd service
    systemctl stop manlab-agent 2>/dev/null || true
    systemctl disable manlab-agent 2>/dev/null || true
    
    # Stop any running agent processes
    log_info "Stopping any running agent processes..."
    if command -v pkill &>/dev/null; then
        pkill -x "manlab-agent" 2>/dev/null || true
    elif command -v killall &>/dev/null; then
        killall "manlab-agent" 2>/dev/null || true
    fi
    # Wait for processes to terminate
    max_wait=10 waited=0
    while [[ $waited -lt $max_wait ]]; do
        if ! pgrep -x "manlab-agent" &>/dev/null; then break; fi
        sleep 1; ((waited++))
    done
    
    # Remove service files
    rm -f /etc/systemd/system/manlab-agent.service 2>/dev/null || true
    rm -f /etc/manlab-agent.env 2>/dev/null || true
    systemctl daemon-reload 2>/dev/null || true
    
    # Remove install directory with retry
    for i in 1 2 3; do
        if rm -rf "$INSTALL_DIR" 2>/dev/null; then
            log_info "Removed directory: $INSTALL_DIR"
            break
        elif [[ $i -lt 3 ]]; then
            log_warn "Retry $i/3: Failed to remove '$INSTALL_DIR', waiting 1s..."
            sleep 1
        else
            log_error "Failed to remove '$INSTALL_DIR' after 3 attempts"
        fi
    done
    
    log_info "Uninstall complete"
    exit 0
fi

[[ -z "$SERVER" ]] && { log_error "--server required"; exit 1; }
SERVER="${SERVER%/}"
RID="$(detect_rid)"
HUB_URL="${SERVER}/hubs/agent"

log_info "Installing ManLab Agent"
log_info "  Server: $SERVER"
log_info "  RID:    $RID"
log_info "  Dir:    $INSTALL_DIR"

log_info "Fetching agent configuration from server..."

# Check existing
[[ -f "$INSTALL_DIR/manlab-agent" && "$FORCE" -ne 1 ]] && { 
    log_error "Already installed. Use --force"; exit 1
}

# Create directory
mkdir -p "$INSTALL_DIR"

# Download binary
log_info "Downloading agent..."

if ! download_from_github "$RID" "$INSTALL_DIR/manlab-agent"; then
    BIN_URL="${SERVER}/api/binaries/agent/${RID}"
    SEP="?"
    if [[ -n "$AGENT_CHANNEL" ]]; then
        BIN_URL="${BIN_URL}${SEP}channel=${AGENT_CHANNEL}"
        SEP="&"
    fi
    if [[ -n "$AGENT_VERSION" ]]; then
        BIN_URL="${BIN_URL}${SEP}version=${AGENT_VERSION}"
        SEP="&"
    fi
    download "$BIN_URL" "$INSTALL_DIR/manlab-agent"
fi

chmod +x "$INSTALL_DIR/manlab-agent"

# Download appsettings.json template from the server.
# This template is generated server-side and includes the Agent Defaults configured in the Web UI.
APPSETTINGS_URL="${SERVER}/api/binaries/agent/${RID}/appsettings.json"
SEP="?"
if [[ -n "$AGENT_CHANNEL" ]]; then
    APPSETTINGS_URL="${APPSETTINGS_URL}${SEP}channel=${AGENT_CHANNEL}"
    SEP="&"
fi
if [[ -n "$AGENT_VERSION" ]]; then
    APPSETTINGS_URL="${APPSETTINGS_URL}${SEP}version=${AGENT_VERSION}"
    SEP="&"
fi
if download "$APPSETTINGS_URL" "$INSTALL_DIR/appsettings.json"; then
        chmod 0644 "$INSTALL_DIR/appsettings.json"
else
        log_warn "Failed to download appsettings.json template; falling back to minimal config"
        cat > "$INSTALL_DIR/appsettings.json" <<EOF
{
    "Agent": {
        "ServerUrl": "$HUB_URL",
        "AuthToken": "",
        "HeartbeatIntervalSeconds": 15,
        "MaxReconnectDelaySeconds": 60,
        "EnableLogViewer": $([ $ENABLE_LOG_VIEWER -eq 1 ] && echo true || echo false),
        "EnableScripts": $([ $ENABLE_SCRIPTS -eq 1 ] && echo true || echo false),
        "EnableTerminal": $([ $ENABLE_TERMINAL -eq 1 ] && echo true || echo false),
        "EnableFileBrowser": $([ $ENABLE_FILE_BROWSER -eq 1 ] && echo true || echo false)
    }
}
EOF
        chmod 0644 "$INSTALL_DIR/appsettings.json"
fi

# Provide connection secrets via environment file (preferred over writing tokens into appsettings.json).
ENV_FILE="/etc/manlab-agent.env"
cat > "$ENV_FILE" <<EOF
MANLAB_SERVER_URL=$HUB_URL
MANLAB_AUTH_TOKEN=$TOKEN
EOF
chmod 0600 "$ENV_FILE"

# Create systemd service
cat > /etc/systemd/system/manlab-agent.service <<EOF
[Unit]
Description=ManLab Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$INSTALL_DIR/manlab-agent
Restart=always
RestartSec=5
$([ $RUN_AS_ROOT -eq 0 ] && echo "User=manlab-agent" || echo "")

[Install]
WantedBy=multi-user.target
EOF

# Create user if needed
if [[ "$RUN_AS_ROOT" -eq 0 ]]; then
    id manlab-agent &>/dev/null || useradd --system --no-create-home --shell /usr/sbin/nologin manlab-agent 2>/dev/null || true
    chown -R manlab-agent:manlab-agent "$INSTALL_DIR" 2>/dev/null || true
fi

# Enable and start
systemctl daemon-reload
systemctl enable manlab-agent
systemctl restart manlab-agent

log_info "Installation complete!"
log_info "Status: systemctl status manlab-agent"
log_info "Logs:   journalctl -u manlab-agent -f"
