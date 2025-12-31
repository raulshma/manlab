#!/usr/bin/env bash
#=============================================================================
# ManLab Agent Installer - Linux/macOS
# Version 2.0.0
#
# Usage:
#   install.sh --server <url> [options]
#   install.sh --uninstall [--install-dir <dir>]
#   install.sh --help
#
# Examples:
#   sudo ./install.sh --server http://manlab:5247 --token "abc123"
#   sudo ./install.sh --server http://manlab:5247 --interactive
#   sudo ./install.sh --uninstall
#=============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Source library modules
source "$SCRIPT_DIR/lib/common.sh"
source "$SCRIPT_DIR/lib/config.sh"
source "$SCRIPT_DIR/lib/download.sh"
source "$SCRIPT_DIR/lib/systemd.sh"
source "$SCRIPT_DIR/lib/launchd.sh"

#=============================================================================
# HELP & VERSION
#=============================================================================

show_version() {
    echo "ManLab Agent Installer v${SCRIPT_VERSION}"
}

show_help() {
    cat <<'EOF'
ManLab Agent Installer (Linux/macOS)

USAGE:
    install.sh --server <url> [options]
    install.sh --uninstall [options]
    install.sh --preview-uninstall

INSTALLATION OPTIONS:
    --server <url>          ManLab server URL (required)
    --token <token>         Authentication token
    --install-dir <dir>     Installation directory (default: /opt/manlab-agent)
    --rid <rid>             Runtime identifier (auto-detected if not specified)
    --force                 Overwrite existing installation
    --run-as-root           Run agent as root instead of dedicated user

WORKFLOW OPTIONS:
    --interactive           Guided installation with prompts
    --dry-run              Preview actions without executing
    --verbose              Verbose output
    --health-check         Verify agent starts after installation
    --verify-checksum      Verify binary checksum (requires server support)
    --config-file <path>   Load configuration from JSON file

REMOTE TOOLS (security-sensitive, disabled by default):
    --enable-log-viewer    Enable remote log viewing
    --enable-scripts       Enable remote script execution
    --enable-terminal      Enable remote terminal access
    --enable-file-browser  Enable remote file browser

TELEMETRY OPTIONS:
    --enable-network-telemetry <bool>    Network throughput telemetry
    --enable-ping-telemetry <bool>       Ping connectivity telemetry
    --enable-gpu-telemetry <bool>        GPU telemetry
    --enable-ups-telemetry <bool>        UPS telemetry
    --enable-enhanced-network-telemetry <bool>
    --enable-enhanced-gpu-telemetry <bool>
    --enable-apm-telemetry <bool>        Application monitoring

ADVANCED OPTIONS:
    --heartbeat-interval <sec>           Heartbeat interval (default: 15)
    --max-reconnect-delay <sec>          Max reconnect delay (default: 60)
    --primary-interface <name>           Primary network interface
    --ping-target <host>                 Ping target override
    --ping-timeout-ms <ms>               Ping timeout (default: 800)

GITHUB RELEASE OPTIONS:
    --prefer-github                      Prefer GitHub releases
    --github-release-url <url>           GitHub release base URL
    --github-version <tag>               GitHub release version tag

UNINSTALL OPTIONS:
    --uninstall             Remove agent and service
    --preview-uninstall     Show what would be removed (JSON output)

OTHER:
    --version              Show version
    --help, -h             Show this help

ENVIRONMENT VARIABLES:
    MANLAB_SERVER_BASE_URL  Server URL (alternative to --server)
    MANLAB_AUTH_TOKEN       Auth token (alternative to --token)
    DRY_RUN=1              Enable dry-run mode
    INTERACTIVE=1          Enable interactive mode
    LOG_LEVEL=DEBUG        Enable debug logging

EXAMPLES:
    # Basic installation
    sudo ./install.sh --server http://manlab:5247 --token "mytoken"

    # Installation with remote tools enabled
    sudo ./install.sh --server http://manlab:5247 --enable-terminal --enable-scripts

    # Dry-run to preview installation
    sudo ./install.sh --server http://manlab:5247 --dry-run

    # Interactive guided installation
    sudo ./install.sh --server http://manlab:5247 --interactive

    # Uninstall
    sudo ./install.sh --uninstall
EOF
}

#=============================================================================
# ARGUMENT PARSING
#=============================================================================

# Defaults
SERVER=""
TOKEN=""
INSTALL_DIR="$DEFAULT_INSTALL_DIR"
RID=""
FORCE=0
UNINSTALL=0
PREVIEW_UNINSTALL=0
RUN_AS_ROOT=0
DO_HEALTH_CHECK=0
VERIFY_CHECKSUM=0
CONFIG_FILE=""
CHECKSUM=""

# GitHub options
PREFER_GITHUB=""
GITHUB_RELEASE_BASE_URL=""
GITHUB_VERSION=""

parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --server|--server-url)
                SERVER="$2"; shift 2 ;;
            --token|--auth-token)
                TOKEN="$2"; shift 2 ;;
            --install-dir)
                INSTALL_DIR="$2"; shift 2 ;;
            --rid)
                RID="$2"; shift 2 ;;
            --force)
                FORCE=1; shift ;;
            --run-as-root)
                RUN_AS_ROOT=1; shift ;;
            --interactive)
                INTERACTIVE=1; shift ;;
            --dry-run)
                DRY_RUN=1; shift ;;
            --verbose)
                LOG_LEVEL="DEBUG"; shift ;;
            --health-check)
                DO_HEALTH_CHECK=1; shift ;;
            --verify-checksum)
                VERIFY_CHECKSUM=1; shift ;;
            --checksum)
                CHECKSUM="$2"; shift 2 ;;
            --config-file)
                CONFIG_FILE="$2"; shift 2 ;;
            --prefer-github)
                PREFER_GITHUB=1; shift ;;
            --github-release-url|--github-release-base-url)
                GITHUB_RELEASE_BASE_URL="$2"; shift 2 ;;
            --github-version)
                GITHUB_VERSION="$2"; shift 2 ;;
            --uninstall)
                UNINSTALL=1; shift ;;
            --preview-uninstall)
                PREVIEW_UNINSTALL=1; shift ;;
            --version)
                show_version; exit 0 ;;
            --help|-h)
                show_help; exit 0 ;;
            # Config options passed through
            --enable-*|--heartbeat-*|--max-*|--primary-*|--ping-*|--telemetry-*|--log-*|--script-*|--terminal-*|--file-*)
                # Parse and accumulate config options
                parse_config_args "$1" "${2:-}"
                if [[ "$1" == "--enable-"* && ! "$1" =~ = ]]; then
                    shift
                else
                    shift 2 2>/dev/null || shift
                fi
                ;;
            *)
                log_error "Unknown option: $1"
                echo "Use --help for usage information"
                exit 1
                ;;
        esac
    done
}

#=============================================================================
# INSTALLATION
#=============================================================================

do_install() {
    local os_kind rid hub_url
    os_kind="$(detect_os)"
    
    # Validate requirements
    validate_url "$SERVER" "Server URL" || exit 1
    
    # Auto-detect RID if not specified
    if [[ -z "$RID" ]]; then
        RID="$(detect_rid)"
    fi
    
    # Construct hub URL
    SERVER="$(trim_trailing_slash "$SERVER")"
    hub_url="${SERVER}/hubs/agent"
    
    log_info "Installing ManLab Agent"
    log_info "  Server:      $SERVER"
    log_info "  Hub URL:     $hub_url"
    log_info "  RID:         $RID"
    log_info "  Install dir: $INSTALL_DIR"
    log_info "  OS:          $os_kind"
    log_info "  Run as:      $([ $RUN_AS_ROOT -eq 1 ] && echo 'root' || echo 'dedicated user')"
    
    # Interactive confirmation
    if [[ "$INTERACTIVE" -eq 1 ]]; then
        if ! confirm "Proceed with installation?"; then
            log_info "Installation cancelled"
            exit 0
        fi
    fi
    
    # Check for existing installation
    if [[ -f "${INSTALL_DIR}/${BIN_NAME}" && "$FORCE" -ne 1 ]]; then
        log_error "Agent already installed at ${INSTALL_DIR}"
        log_error "Use --force to overwrite"
        exit 1
    fi
    
    # Create dedicated user (if not running as root)
    if [[ "$RUN_AS_ROOT" -eq 0 && "$os_kind" == "linux" ]]; then
        create_system_user "$AGENT_USER"
    fi
    
    # Create install directory
    ensure_dir "$INSTALL_DIR"
    
    # Download agent binary
    local bin_path="${INSTALL_DIR}/${BIN_NAME}"
    if ! download_agent_binary "$SERVER" "$RID" "$bin_path" "$CHECKSUM"; then
        log_error "Failed to download agent binary"
        exit 1
    fi
    
    # Download or create appsettings.json
    local appsettings_path="${INSTALL_DIR}/appsettings.json"
    download_appsettings "$SERVER" "$RID" "$appsettings_path" || true
    
    # Load config file if specified
    if [[ -n "$CONFIG_FILE" ]]; then
        config_from_file "$CONFIG_FILE"
    fi
    
    # Set core configuration
    config_set "Agent.ServerUrl" "$hub_url"
    config_set_if_not_empty "Agent.AuthToken" "$TOKEN"
    
    # Write configuration
    if [[ ! -f "$appsettings_path" ]]; then
        create_minimal_appsettings "$appsettings_path" "$hub_url" "$TOKEN"
    fi
    config_write "$appsettings_path"
    
    # Secure configuration file
    local config_owner=""
    [[ "$RUN_AS_ROOT" -eq 0 ]] && config_owner="$AGENT_USER"
    secure_config_file "$appsettings_path" "$config_owner"
    
    # Set ownership of install directory
    if [[ "$RUN_AS_ROOT" -eq 0 && "$os_kind" == "linux" ]] && id "$AGENT_USER" &>/dev/null; then
        chown -R "$AGENT_USER:$AGENT_USER" "$INSTALL_DIR" 2>/dev/null || true
    fi
    
    # Install service based on init system
    case "$os_kind" in
        linux)
            if systemd_available; then
                systemd_install "$INSTALL_DIR" "$BIN_NAME" "$hub_url" "$TOKEN" "$RUN_AS_ROOT"
            else
                log_error "systemd not available - cannot install service"
                exit 1
            fi
            ;;
        darwin)
            if launchd_available; then
                launchd_install "$INSTALL_DIR" "$BIN_NAME" "$hub_url" "$TOKEN" "$RUN_AS_ROOT"
            else
                log_error "launchd not available - cannot install service"
                exit 1
            fi
            ;;
    esac
    
    # Health check
    if [[ "$DO_HEALTH_CHECK" -eq 1 ]]; then
        if ! wait_for_agent 30; then
            log_warn "Agent may not have started correctly"
        fi
    fi
    
    log_info ""
    log_info "Installation complete!"
    log_info "To uninstall: sudo $0 --uninstall"
}

#=============================================================================
# UNINSTALL
#=============================================================================

do_uninstall() {
    local os_kind
    os_kind="$(detect_os)"
    
    log_info "Uninstalling ManLab Agent"
    log_info "  Install dir: $INSTALL_DIR"
    
    if [[ "$INTERACTIVE" -eq 1 ]]; then
        if ! confirm "Are you sure you want to uninstall?"; then
            log_info "Uninstall cancelled"
            exit 0
        fi
    fi
    
    # Remove service
    case "$os_kind" in
        linux)
            systemd_uninstall "$SERVICE_NAME"
            ;;
        darwin)
            launchd_uninstall
            ;;
    esac
    
    # Remove user
    remove_system_user "$AGENT_USER"
    
    # Remove install directory
    if [[ -d "$INSTALL_DIR" ]]; then
        safe_remove "$INSTALL_DIR"
    fi
    
    log_info "Uninstall complete"
}

#=============================================================================
# PREVIEW UNINSTALL
#=============================================================================

do_preview_uninstall() {
    local os_kind
    os_kind="$(detect_os)"
    
    local sections=""
    local notes=()
    
    # Service items
    local service_items=()
    case "$os_kind" in
        linux)
            while IFS= read -r item; do
                [[ -n "$item" ]] && service_items+=("$item")
            done < <(systemd_inventory "$SERVICE_NAME" 2>/dev/null || true)
            ;;
        darwin)
            while IFS= read -r item; do
                [[ -n "$item" ]] && service_items+=("$item")
            done < <(launchd_inventory 2>/dev/null || true)
            ;;
    esac
    
    # Directory items
    local dir_items=()
    if [[ -d "$INSTALL_DIR" ]]; then
        dir_items+=("$INSTALL_DIR")
    fi
    
    # User
    local user_items=()
    if id "$AGENT_USER" &>/dev/null; then
        user_items+=("User: $AGENT_USER")
    fi
    
    # Output JSON
    printf '{"success":true,"osHint":"%s","sections":[' "${os_kind^}"
    printf '{"label":"Service files","items":[%s]},' "$(printf '"%s",' "${service_items[@]}" | sed 's/,$//')"
    printf '{"label":"Directories","items":[%s]},' "$(printf '"%s",' "${dir_items[@]}" | sed 's/,$//')"
    printf '{"label":"Users","items":[%s]}' "$(printf '"%s",' "${user_items[@]}" | sed 's/,$//')"
    printf '],"notes":[],"error":null}\n'
}

#=============================================================================
# MAIN
#=============================================================================

main() {
    setup_trap
    
    # Parse arguments
    parse_args "$@"
    
    # Support environment variables
    [[ -z "$SERVER" ]] && SERVER="${MANLAB_SERVER_BASE_URL:-${MANLAB_SERVER:-}}"
    [[ -z "$TOKEN" ]] && TOKEN="${MANLAB_ENROLLMENT_TOKEN:-${MANLAB_AUTH_TOKEN:-}}"
    
    # Preview uninstall doesn't require root
    if [[ "$PREVIEW_UNINSTALL" -eq 1 ]]; then
        do_preview_uninstall
        exit 0
    fi
    
    # Require root for install/uninstall
    require_root
    require_cmds uname id mkdir chmod rm cp mktemp
    
    if [[ "$UNINSTALL" -eq 1 ]]; then
        do_uninstall
    else
        if [[ -z "$SERVER" ]]; then
            log_error "--server is required"
            echo "Use --help for usage information"
            exit 1
        fi
        do_install
    fi
}

main "$@"
