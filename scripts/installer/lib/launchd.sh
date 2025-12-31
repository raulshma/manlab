#!/usr/bin/env bash
# ManLab Agent Installer - Launchd Service Module
# Handles launchd plist installation and management for macOS

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -z "${COMMON_SOURCED:-}" ]] && source "$SCRIPT_DIR/common.sh"

readonly LAUNCHD_DAEMONS_DIR="/Library/LaunchDaemons"
readonly LAUNCHD_PLIST_NAME="com.manlab.agent"
readonly LAUNCHD_LOG_DIR="/var/log"

launchd_available() {
    [[ -d "$LAUNCHD_DAEMONS_DIR" ]] && command -v launchctl &>/dev/null
}

launchd_create_plist() {
    local install_dir="$1" bin_name="$2" hub_url="$3"
    local auth_token="${4:-}" run_as_user="${5:-}"
    local plist_name="${6:-$LAUNCHD_PLIST_NAME}"
    local plist_file="${LAUNCHD_DAEMONS_DIR}/${plist_name}.plist"
    
    log_info "Creating launchd plist: $plist_file"
    [[ "$DRY_RUN" -eq 1 ]] && { log_info "[DRY RUN] Would create plist"; return 0; }
    
    cat > "$plist_file" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key><string>${plist_name}</string>
    <key>ProgramArguments</key><array><string>${install_dir}/${bin_name}</string></array>
    <key>WorkingDirectory</key><string>${install_dir}</string>
    <key>EnvironmentVariables</key>
    <dict>
        <key>MANLAB_SERVER_URL</key><string>${hub_url}</string>
EOF
    [[ -n "$auth_token" ]] && echo "        <key>MANLAB_AUTH_TOKEN</key><string>${auth_token}</string>" >> "$plist_file"
    echo "    </dict>" >> "$plist_file"
    [[ -n "$run_as_user" ]] && echo "    <key>UserName</key><string>${run_as_user}</string>" >> "$plist_file"
    cat >> "$plist_file" <<EOF
    <key>RunAtLoad</key><true/>
    <key>KeepAlive</key><true/>
    <key>StandardOutPath</key><string>${LAUNCHD_LOG_DIR}/manlab-agent.log</string>
    <key>StandardErrorPath</key><string>${LAUNCHD_LOG_DIR}/manlab-agent.err.log</string>
</dict>
</plist>
EOF
    chmod 0644 "$plist_file"
}

launchd_load_service() {
    local plist_name="${1:-$LAUNCHD_PLIST_NAME}"
    local plist_file="${LAUNCHD_DAEMONS_DIR}/${plist_name}.plist"
    log_info "Loading launchd service: $plist_name"
    [[ "$DRY_RUN" -eq 1 ]] && return 0
    launchctl bootout system "$plist_file" 2>/dev/null || true
    launchctl bootstrap system "$plist_file"
    launchctl enable "system/${plist_name}" 2>/dev/null || true
    launchctl kickstart -k "system/${plist_name}" 2>/dev/null || true
}

launchd_remove_service() {
    local plist_name="${1:-$LAUNCHD_PLIST_NAME}"
    log_info "Removing launchd service: $plist_name"
    [[ "$DRY_RUN" -eq 1 ]] && return 0
    launchctl bootout system "${LAUNCHD_DAEMONS_DIR}/${plist_name}.plist" 2>/dev/null || true
    rm -f "${LAUNCHD_DAEMONS_DIR}/${plist_name}.plist" 2>/dev/null || true
}

launchd_status() {
    local plist_name="${1:-$LAUNCHD_PLIST_NAME}"
    if launchctl list 2>/dev/null | grep -q "$plist_name"; then echo "running"
    elif [[ -f "${LAUNCHD_DAEMONS_DIR}/${plist_name}.plist" ]]; then echo "stopped"
    else echo "not-installed"; fi
}

launchd_install() {
    local install_dir="$1" bin_name="$2" hub_url="$3"
    local auth_token="${4:-}" run_as_root="${5:-0}"
    local run_as_user=""
    [[ "$run_as_root" -eq 0 ]] && create_system_user "$AGENT_USER" && run_as_user="$AGENT_USER"
    launchd_create_plist "$install_dir" "$bin_name" "$hub_url" "$auth_token" "$run_as_user"
    launchd_load_service
    log_info "Launchd service installed. Logs: ${LAUNCHD_LOG_DIR}/manlab-agent.log"
}

launchd_uninstall() {
    local plist_name="${1:-$LAUNCHD_PLIST_NAME}"
    if [[ "$(launchd_status)" == "not-installed" ]]; then
        log_info "Service not installed"
        return 0
    fi
    launchd_remove_service "$plist_name"
    # Stop any remaining agent processes
    stop_agent_processes
    remove_system_user "$AGENT_USER"
}

export -f launchd_available launchd_create_plist launchd_load_service
export -f launchd_remove_service launchd_status launchd_install launchd_uninstall
