#!/usr/bin/env bash
# ManLab Agent Installer - Configuration Module
# Handles appsettings.json creation and modification

set -euo pipefail

# Source common library if not already sourced
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=common.sh
[[ -z "${COMMON_SOURCED:-}" ]] && source "$SCRIPT_DIR/common.sh"

#=============================================================================
# CONFIGURATION STRUCTURE
#=============================================================================

# All configuration options with defaults
declare -A CONFIG_DEFAULTS=(
    # Core settings
    ["Agent.ServerUrl"]=""
    ["Agent.AuthToken"]=""
    ["Agent.HeartbeatIntervalSeconds"]="15"
    ["Agent.MaxReconnectDelaySeconds"]="60"
    ["Agent.TelemetryCacheSeconds"]="30"
    ["Agent.PrimaryInterfaceName"]=""
    
    # Basic telemetry toggles
    ["Agent.EnableNetworkTelemetry"]="true"
    ["Agent.EnablePingTelemetry"]="true"
    ["Agent.EnableGpuTelemetry"]="true"
    ["Agent.EnableUpsTelemetry"]="true"
    
    # Enhanced telemetry
    ["Agent.EnableEnhancedNetworkTelemetry"]="true"
    ["Agent.EnableEnhancedGpuTelemetry"]="true"
    ["Agent.EnableApmTelemetry"]="false"
    
    # Ping settings
    ["Agent.PingTarget"]=""
    ["Agent.PingTimeoutMs"]="800"
    ["Agent.PingWindowSize"]="10"
    
    # Remote tools (security-sensitive, default-deny)
    ["Agent.EnableLogViewer"]="false"
    ["Agent.EnableScripts"]="false"
    ["Agent.EnableTerminal"]="false"
    ["Agent.EnableFileBrowser"]="false"
    
    # Resource limits
    ["Agent.LogMaxBytes"]="65536"
    ["Agent.LogMinSecondsBetweenRequests"]="1"
    ["Agent.ScriptMaxOutputBytes"]="65536"
    ["Agent.ScriptMaxDurationSeconds"]="60"
    ["Agent.ScriptMinSecondsBetweenRuns"]="1"
    ["Agent.TerminalMaxOutputBytes"]="65536"
    ["Agent.TerminalMaxDurationSeconds"]="600"
    ["Agent.FileBrowserMaxBytes"]="2097152"
    ["Agent.FileZipMaxUncompressedBytes"]="1073741824"
    ["Agent.FileZipMaxFileCount"]="10000"
    
    # Agent logging
    ["Agent.AgentLogFilePath"]=""
    ["Agent.AgentLogFileMaxBytes"]="5242880"
    ["Agent.AgentLogFileRetainedFiles"]="3"
)

#=============================================================================
# CONFIGURATION FUNCTIONS
#=============================================================================

# Accumulator for configuration values to be written
declare -A CONFIG_VALUES=()

config_set() {
    local key="$1"
    local value="$2"
    
    if [[ -z "$value" ]]; then
        return 0
    fi
    
    CONFIG_VALUES["$key"]="$value"
    log_debug "Config: $key = $value"
}

config_set_if_not_empty() {
    local key="$1"
    local value="$2"
    
    if [[ -n "$value" ]]; then
        config_set "$key" "$value"
    fi
}

config_set_bool() {
    local key="$1"
    local value="$2"
    
    case "${value,,}" in
        true|1|yes|on)   config_set "$key" "true" ;;
        false|0|no|off)  config_set "$key" "false" ;;
        *)
            log_warn "Invalid boolean value for $key: $value"
            ;;
    esac
}

config_write() {
    local file="$1"
    
    if [[ ${#CONFIG_VALUES[@]} -eq 0 ]]; then
        log_debug "No configuration values to write"
        return 0
    fi
    
    log_info "Writing configuration to $file"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would write configuration:"
        for key in "${!CONFIG_VALUES[@]}"; do
            local value="${CONFIG_VALUES[$key]}"
            # Mask sensitive values
            if [[ "$key" == *"Token"* || "$key" == *"Password"* ]]; then
                value="***"
            fi
            log_info "  $key = $value"
        done
        return 0
    fi
    
    # Ensure directory exists
    local dir
    dir=$(dirname "$file")
    mkdir -p "$dir"
    
    # Build configuration
    for key in "${!CONFIG_VALUES[@]}"; do
        json_set_file "$file" "$key" "${CONFIG_VALUES[$key]}"
    done
    
    log_info "Configuration written successfully"
}

config_from_file() {
    local file="$1"
    
    if [[ ! -f "$file" ]]; then
        log_error "Configuration file not found: $file"
        return 1
    fi
    
    log_info "Loading configuration from $file"
    
    if ! command -v python3 &>/dev/null; then
        log_error "python3 required to parse configuration file"
        return 1
    fi
    
    # Parse JSON file and extract Agent section
    local config_json
    config_json=$(python3 -c "
import json, sys
with open('$file', 'r') as f:
    data = json.load(f)
agent = data.get('Agent', {})
for k, v in agent.items():
    print(f'Agent.{k}={v}')
" 2>/dev/null) || {
        log_error "Failed to parse configuration file"
        return 1
    }
    
    while IFS='=' read -r key value; do
        config_set "$key" "$value"
    done <<< "$config_json"
    
    log_info "Configuration loaded"
}

#=============================================================================
# APPSETTINGS.JSON MANAGEMENT
#=============================================================================

create_minimal_appsettings() {
    local file="$1"
    local server_url="$2"
    local auth_token="${3:-}"
    
    log_info "Creating minimal appsettings.json"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would create: $file"
        return 0
    fi
    
    local token_line=""
    if [[ -n "$auth_token" ]]; then
        token_line="\"AuthToken\": \"$auth_token\","
    fi
    
    cat > "$file" <<EOF
{
  "Agent": {
    "ServerUrl": "$server_url",
    $token_line
    "HeartbeatIntervalSeconds": 15,
        "MaxReconnectDelaySeconds": 60,
        "TelemetryCacheSeconds": 30,
        "PrimaryInterfaceName": "",
        "EnableNetworkTelemetry": true,
        "EnablePingTelemetry": true,
        "EnableGpuTelemetry": true,
        "EnableUpsTelemetry": true,
        "EnableEnhancedNetworkTelemetry": true,
        "EnableEnhancedGpuTelemetry": true,
        "EnableApmTelemetry": false,
        "ApmHealthCheckEndpoints": [],
        "ApmDatabaseEndpoints": [],
        "EnableLogViewer": false,
        "EnableScripts": false,
        "EnableTerminal": false,
        "EnableFileBrowser": false,
        "PingTarget": "",
        "PingTimeoutMs": 800,
        "PingWindowSize": 10,
        "LogMaxBytes": 65536,
        "LogMinSecondsBetweenRequests": 1,
        "ScriptMaxOutputBytes": 65536,
        "ScriptMaxDurationSeconds": 60,
        "ScriptMinSecondsBetweenRuns": 1,
        "TerminalMaxOutputBytes": 65536,
        "TerminalMaxDurationSeconds": 600,
        "FileBrowserMaxBytes": 2097152,
        "FileZipMaxUncompressedBytes": 1073741824,
        "FileZipMaxFileCount": 10000,
        "AgentLogFilePath": "",
        "AgentLogFileMaxBytes": 5242880,
        "AgentLogFileRetainedFiles": 3
  }
}
EOF
    
    log_debug "Created: $file"
}

update_appsettings() {
    local file="$1"
    
    if [[ ! -f "$file" ]]; then
        log_debug "Creating new appsettings.json"
        echo '{}' > "$file"
    fi
    
    log_info "Updating appsettings.json"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would update: $file"
        return 0
    fi
    
    # Apply all accumulated config values
    config_write "$file"
}

secure_config_file() {
    local file="$1"
    local owner="${2:-}"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would secure: $file (owner: ${owner:-root})"
        return 0
    fi
    
    if [[ -f "$file" ]]; then
        if [[ -n "$owner" ]] && id "$owner" &>/dev/null; then
            chown "$owner:$owner" "$file" 2>/dev/null || true
            chmod 0600 "$file"
        else
            chmod 0644 "$file"
        fi
        log_debug "Secured: $file"
    fi
}

#=============================================================================
# CLI ARGUMENT PARSING HELPERS
#=============================================================================

parse_config_args() {
    # Parse configuration-related CLI arguments
    # Updates CONFIG_VALUES based on provided arguments
    
    while [[ $# -gt 0 ]]; do
        case "$1" in
            # Core settings
            --server-url|--server)
                config_set "Agent.ServerUrl" "$2"; shift 2 ;;
            --token|--auth-token)
                config_set "Agent.AuthToken" "$2"; shift 2 ;;
            --heartbeat-interval)
                config_set "Agent.HeartbeatIntervalSeconds" "$2"; shift 2 ;;
            --max-reconnect-delay)
                config_set "Agent.MaxReconnectDelaySeconds" "$2"; shift 2 ;;
            --telemetry-cache-seconds)
                config_set "Agent.TelemetryCacheSeconds" "$2"; shift 2 ;;
            --primary-interface)
                config_set "Agent.PrimaryInterfaceName" "$2"; shift 2 ;;
            
            # Basic telemetry
            --enable-network-telemetry)
                config_set_bool "Agent.EnableNetworkTelemetry" "$2"; shift 2 ;;
            --enable-ping-telemetry)
                config_set_bool "Agent.EnablePingTelemetry" "$2"; shift 2 ;;
            --enable-gpu-telemetry)
                config_set_bool "Agent.EnableGpuTelemetry" "$2"; shift 2 ;;
            --enable-ups-telemetry)
                config_set_bool "Agent.EnableUpsTelemetry" "$2"; shift 2 ;;
            
            # Enhanced telemetry
            --enable-enhanced-network-telemetry)
                config_set_bool "Agent.EnableEnhancedNetworkTelemetry" "$2"; shift 2 ;;
            --enable-enhanced-gpu-telemetry)
                config_set_bool "Agent.EnableEnhancedGpuTelemetry" "$2"; shift 2 ;;
            --enable-apm-telemetry)
                config_set_bool "Agent.EnableApmTelemetry" "$2"; shift 2 ;;
            
            # Ping settings
            --ping-target)
                config_set "Agent.PingTarget" "$2"; shift 2 ;;
            --ping-timeout-ms)
                config_set "Agent.PingTimeoutMs" "$2"; shift 2 ;;
            --ping-window-size)
                config_set "Agent.PingWindowSize" "$2"; shift 2 ;;
            
            # Remote tools
            --enable-log-viewer)
                config_set_bool "Agent.EnableLogViewer" "true"; shift ;;
            --enable-scripts)
                config_set_bool "Agent.EnableScripts" "true"; shift ;;
            --enable-terminal)
                config_set_bool "Agent.EnableTerminal" "true"; shift ;;
            --enable-file-browser)
                config_set_bool "Agent.EnableFileBrowser" "true"; shift ;;
            
            # Resource limits
            --log-max-bytes)
                config_set "Agent.LogMaxBytes" "$2"; shift 2 ;;
            --script-max-output-bytes)
                config_set "Agent.ScriptMaxOutputBytes" "$2"; shift 2 ;;
            --script-max-duration-seconds)
                config_set "Agent.ScriptMaxDurationSeconds" "$2"; shift 2 ;;
            --terminal-max-output-bytes)
                config_set "Agent.TerminalMaxOutputBytes" "$2"; shift 2 ;;
            --terminal-max-duration-seconds)
                config_set "Agent.TerminalMaxDurationSeconds" "$2"; shift 2 ;;
            --file-browser-max-bytes)
                config_set "Agent.FileBrowserMaxBytes" "$2"; shift 2 ;;
            
            # Pass through unrecognized args
            *)
                shift ;;
        esac
    done
}

# Export functions
export -f config_set config_set_if_not_empty config_set_bool config_write
export -f config_from_file create_minimal_appsettings update_appsettings
export -f secure_config_file parse_config_args

COMMON_SOURCED=1
