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
        curl -fsSL "$url" -o "$out"
    elif command -v wget &>/dev/null; then
        wget -qO "$out" "$url"
    else
        log_error "curl or wget required"; exit 1
    fi
}

# Parse arguments
SERVER="" TOKEN="" INSTALL_DIR="/opt/manlab-agent" FORCE=0 UNINSTALL=0 RUN_AS_ROOT=0
ENABLE_LOG_VIEWER=0 ENABLE_SCRIPTS=0 ENABLE_TERMINAL=0 ENABLE_FILE_BROWSER=0

while [[ $# -gt 0 ]]; do
    case "$1" in
        --server)         SERVER="$2"; shift 2 ;;
        --token)          TOKEN="$2"; shift 2 ;;
        --install-dir)    INSTALL_DIR="$2"; shift 2 ;;
        --force)          FORCE=1; shift ;;
        --run-as-root)    RUN_AS_ROOT=1; shift ;;
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
    local max_wait=10 waited=0
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

# Check existing
[[ -f "$INSTALL_DIR/manlab-agent" && "$FORCE" -ne 1 ]] && { 
    log_error "Already installed. Use --force"; exit 1
}

# Create directory
mkdir -p "$INSTALL_DIR"

# Download binary
log_info "Downloading agent..."
download "${SERVER}/api/binaries/agent/${RID}" "$INSTALL_DIR/manlab-agent"
chmod +x "$INSTALL_DIR/manlab-agent"

# Create appsettings.json
cat > "$INSTALL_DIR/appsettings.json" <<EOF
{
  "Agent": {
    "ServerUrl": "$HUB_URL",
    "AuthToken": "$TOKEN",
    "HeartbeatIntervalSeconds": 15,
    "MaxReconnectDelaySeconds": 60,
    "EnableLogViewer": $([ $ENABLE_LOG_VIEWER -eq 1 ] && echo true || echo false),
    "EnableScripts": $([ $ENABLE_SCRIPTS -eq 1 ] && echo true || echo false),
    "EnableTerminal": $([ $ENABLE_TERMINAL -eq 1 ] && echo true || echo false),
    "EnableFileBrowser": $([ $ENABLE_FILE_BROWSER -eq 1 ] && echo true || echo false)
  }
}
EOF
chmod 0600 "$INSTALL_DIR/appsettings.json"

# Create systemd service
cat > /etc/systemd/system/manlab-agent.service <<EOF
[Unit]
Description=ManLab Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$INSTALL_DIR
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
