#!/usr/bin/env bash
# ManLab Agent Installer - Systemd Service Module
# Handles systemd service installation and management for Linux

set -euo pipefail

# Source common library if not already sourced
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
[[ -z "${COMMON_SOURCED:-}" ]] && source "$SCRIPT_DIR/common.sh"

#=============================================================================
# SYSTEMD PATHS
#=============================================================================

readonly SYSTEMD_UNIT_DIR="/etc/systemd/system"
readonly SYSTEMD_ENV_DIR="/etc"

#=============================================================================
# SERVICE MANAGEMENT
#=============================================================================

systemd_available() {
    command -v systemctl &>/dev/null && systemctl --version &>/dev/null
}

systemd_create_unit() {
    local service_name="$1"
    local install_dir="$2"
    local bin_name="$3"
    local run_as_root="${4:-0}"
    local env_file="${5:-/etc/${service_name}.env}"
    
    local unit_file="${SYSTEMD_UNIT_DIR}/${service_name}.service"
    
    log_info "Creating systemd unit: $unit_file"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would create systemd unit at: $unit_file"
        return 0
    fi
    
    # Determine user directive
    local user_directive=""
    if [[ "$run_as_root" -eq 0 ]] && id "$AGENT_USER" &>/dev/null; then
        user_directive="User=$AGENT_USER"
    fi
    
    cat > "$unit_file" <<EOF
[Unit]
Description=ManLab Agent
Documentation=https://github.com/raulshma/manlab
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=$install_dir
ExecStart=${install_dir}/${bin_name}
Restart=always
RestartSec=5
$user_directive
EnvironmentFile=$env_file

# Hardening (best-effort)
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

# Logging
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$service_name

[Install]
WantedBy=multi-user.target
EOF
    
    chmod 0644 "$unit_file"
    log_debug "Created unit: $unit_file"
}

systemd_create_env() {
    local env_file="$1"
    local hub_url="$2"
    local auth_token="${3:-}"
    
    log_info "Creating environment file: $env_file"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would create env file at: $env_file"
        return 0
    fi
    
    {
        echo "MANLAB_SERVER_URL=$hub_url"
        if [[ -n "$auth_token" ]]; then
            echo "MANLAB_AUTH_TOKEN=$auth_token"
        fi
    } > "$env_file"
    
    chmod 0600 "$env_file"
    log_debug "Created env file: $env_file"
}

systemd_enable_service() {
    local service_name="$1"
    
    log_info "Enabling service: $service_name"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would enable and start: $service_name"
        return 0
    fi
    
    systemctl daemon-reload
    systemctl enable "$service_name" &>/dev/null
    systemctl restart "$service_name"
    
    log_info "Service enabled and started: $service_name"
}

systemd_disable_service() {
    local service_name="$1"
    
    log_info "Disabling service: $service_name"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would stop and disable: $service_name"
        return 0
    fi
    
    systemctl stop "$service_name" 2>/dev/null || true
    systemctl disable "$service_name" 2>/dev/null || true
    
    log_debug "Service disabled: $service_name"
}

systemd_remove_service() {
    local service_name="$1"
    
    log_info "Removing systemd service: $service_name"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would remove systemd service: $service_name"
        return 0
    fi
    
    # Stop and disable
    systemd_disable_service "$service_name"
    
    # Remove unit files from all possible locations
    local unit_locations=(
        "${SYSTEMD_UNIT_DIR}/${service_name}.service"
        "/lib/systemd/system/${service_name}.service"
        "/usr/lib/systemd/system/${service_name}.service"
    )
    
    for unit_file in "${unit_locations[@]}"; do
        if [[ -f "$unit_file" ]]; then
            rm -f "$unit_file"
            log_debug "Removed: $unit_file"
        fi
    done
    
    # Remove env file
    local env_file="/etc/${service_name}.env"
    if [[ -f "$env_file" ]]; then
        rm -f "$env_file"
        log_debug "Removed: $env_file"
    fi
    
    # Distro-specific leftovers
    rm -f "/etc/default/${service_name}" 2>/dev/null || true
    rm -f "/etc/sysconfig/${service_name}" 2>/dev/null || true
    
    systemctl daemon-reload
    
    log_info "Service removed: $service_name"
}

systemd_status() {
    local service_name="$1"
    
    if systemctl is-active --quiet "$service_name" 2>/dev/null; then
        echo "running"
    elif systemctl is-enabled --quiet "$service_name" 2>/dev/null; then
        echo "stopped"
    else
        echo "not-installed"
    fi
}

systemd_logs() {
    local service_name="$1"
    local lines="${2:-50}"
    
    journalctl -u "$service_name" -n "$lines" --no-pager
}

#=============================================================================
# FULL INSTALL/UNINSTALL
#=============================================================================

systemd_install() {
    local install_dir="$1"
    local bin_name="$2"
    local hub_url="$3"
    local auth_token="${4:-}"
    local run_as_root="${5:-0}"
    local service_name="${6:-$SERVICE_NAME}"
    
    local env_file="/etc/${service_name}.env"
    
    log_info "Installing systemd service: $service_name"
    
    # Create env file
    systemd_create_env "$env_file" "$hub_url" "$auth_token"
    
    # Create unit file
    systemd_create_unit "$service_name" "$install_dir" "$bin_name" "$run_as_root" "$env_file"
    
    # Enable and start
    systemd_enable_service "$service_name"
    
    log_info "Systemd service installed successfully"
    log_info "Check status: systemctl status $service_name"
    log_info "View logs: journalctl -u $service_name -f"
}

systemd_uninstall() {
    local service_name="${1:-$SERVICE_NAME}"
    
    log_info "Uninstalling systemd service: $service_name"
    
    # Check if service exists
    if [[ "$(systemd_status "$service_name")" == "not-installed" ]]; then
        log_info "Service not installed, nothing to do"
        return 0
    fi
    
    # Remove service
    systemd_remove_service "$service_name"
    
    # Stop any remaining agent processes
    stop_agent_processes
    
    log_info "Systemd service uninstalled successfully"
}

#=============================================================================
# INVENTORY FOR UNINSTALL PREVIEW
#=============================================================================

systemd_inventory() {
    local service_name="${1:-$SERVICE_NAME}"
    
    local items=()
    
    # Unit files
    local unit_locations=(
        "${SYSTEMD_UNIT_DIR}/${service_name}.service"
        "/lib/systemd/system/${service_name}.service"
        "/usr/lib/systemd/system/${service_name}.service"
    )
    
    for unit_file in "${unit_locations[@]}"; do
        if [[ -f "$unit_file" ]]; then
            items+=("$unit_file")
        fi
    done
    
    # Env file
    local env_file="/etc/${service_name}.env"
    if [[ -f "$env_file" ]]; then
        items+=("$env_file")
    fi
    
    # Distro-specific
    for f in "/etc/default/${service_name}" "/etc/sysconfig/${service_name}"; do
        if [[ -f "$f" ]]; then
            items+=("$f")
        fi
    done
    
    printf '%s\n' "${items[@]}"
}

# Export functions
export -f systemd_available systemd_create_unit systemd_create_env
export -f systemd_enable_service systemd_disable_service systemd_remove_service
export -f systemd_status systemd_logs systemd_install systemd_uninstall
export -f systemd_inventory
