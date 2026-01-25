#!/usr/bin/env bash
# ManLab Agent Installer - Common Library
# Shared utilities for Linux/macOS installation scripts
# shellcheck disable=SC2034

set -euo pipefail

#=============================================================================
# CONSTANTS
#=============================================================================

readonly SCRIPT_VERSION="2.0.0"
readonly DEFAULT_INSTALL_DIR="/opt/manlab-agent"
readonly SERVICE_NAME="manlab-agent"
readonly AGENT_USER="manlab-agent"
readonly BIN_NAME="manlab-agent"

# Colors (if terminal supports)
if [[ -t 1 ]] && command -v tput &>/dev/null; then
    readonly COLOR_RED=$(tput setaf 1 2>/dev/null || echo "")
    readonly COLOR_GREEN=$(tput setaf 2 2>/dev/null || echo "")
    readonly COLOR_YELLOW=$(tput setaf 3 2>/dev/null || echo "")
    readonly COLOR_BLUE=$(tput setaf 4 2>/dev/null || echo "")
    readonly COLOR_RESET=$(tput sgr0 2>/dev/null || echo "")
else
    readonly COLOR_RED=""
    readonly COLOR_GREEN=""
    readonly COLOR_YELLOW=""
    readonly COLOR_BLUE=""
    readonly COLOR_RESET=""
fi

#=============================================================================
# LOGGING
#=============================================================================

LOG_LEVEL="${LOG_LEVEL:-INFO}"
LOG_FILE="${LOG_FILE:-}"
DRY_RUN="${DRY_RUN:-0}"

log_debug() { [[ "$LOG_LEVEL" == "DEBUG" ]] && _log "DEBUG" "$COLOR_BLUE" "$@"; }
log_info()  { _log "INFO" "$COLOR_GREEN" "$@"; }
log_warn()  { _log "WARN" "$COLOR_YELLOW" "$@"; }
log_error() { _log "ERROR" "$COLOR_RED" "$@" >&2; }

_log() {
    local level="$1"
    local color="$2"
    shift 2
    local timestamp
    timestamp="$(date '+%Y-%m-%d %H:%M:%S' 2>/dev/null || echo "")"
    local message="[${timestamp}] ${level}: $*"
    
    echo -e "${color}${message}${COLOR_RESET}"
    
    if [[ -n "$LOG_FILE" ]]; then
        echo "$message" >> "$LOG_FILE"
    fi
}

#=============================================================================
# VALIDATION & REQUIREMENTS
#=============================================================================

require_root() {
    if [[ "$(id -u)" -ne 0 ]]; then
        log_error "This installer must be run as root (use sudo)."
        exit 1
    fi
}

require_cmd() {
    local cmd="$1"
    if ! command -v "$cmd" &>/dev/null; then
        log_error "Required command not found: $cmd"
        exit 1
    fi
}

require_cmds() {
    for cmd in "$@"; do
        require_cmd "$cmd"
    done
}

check_network() {
    local url="$1"
    local host
    host=$(echo "$url" | sed -E 's|^https?://||' | cut -d':' -f1 | cut -d'/' -f1)
    
    if command -v ping &>/dev/null; then
        if ! ping -c 1 -W 5 "$host" &>/dev/null; then
            log_warn "Cannot reach $host - network may be unavailable"
            return 1
        fi
    fi
    return 0
}

validate_url() {
    local url="$1"
    local name="$2"
    
    if [[ -z "$url" ]]; then
        log_error "$name is required"
        return 1
    fi
    
    if [[ ! "$url" =~ ^https?:// ]]; then
        log_error "$name must start with http:// or https://"
        return 1
    fi
    
    return 0
}

#=============================================================================
# OS & ARCHITECTURE DETECTION
#=============================================================================

detect_os() {
    local os
    os="$(uname -s | tr '[:upper:]' '[:lower:]')"
    case "$os" in
        linux)  echo "linux" ;;
        darwin) echo "darwin" ;;
        *)
            log_error "Unsupported OS: $os"
            exit 1
            ;;
    esac
}

detect_arch() {
    local arch
    arch="$(uname -m)"
    case "$arch" in
        x86_64|amd64)   echo "x64" ;;
        aarch64|arm64)  echo "arm64" ;;
        *)
            log_error "Unsupported architecture: $arch"
            exit 1
            ;;
    esac
}

detect_rid() {
    local os arch
    os="$(detect_os)"
    arch="$(detect_arch)"
    
    case "$os" in
        linux)  echo "linux-${arch}" ;;
        darwin) echo "osx-${arch}" ;;
    esac
}

detect_distro() {
    if [[ -f /etc/os-release ]]; then
        # shellcheck source=/dev/null
        . /etc/os-release
        echo "${ID:-unknown}"
    elif command -v lsb_release &>/dev/null; then
        lsb_release -si | tr '[:upper:]' '[:lower:]'
    else
        echo "unknown"
    fi
}

detect_init_system() {
    if command -v systemctl &>/dev/null && systemctl --version &>/dev/null; then
        echo "systemd"
    elif [[ -d /Library/LaunchDaemons ]]; then
        echo "launchd"
    elif command -v service &>/dev/null; then
        echo "sysvinit"
    else
        echo "unknown"
    fi
}

#=============================================================================
# DOWNLOAD UTILITIES
#=============================================================================

download_file() {
    local url="$1"
    local dest="$2"
    local description="${3:-file}"
    
    log_info "Downloading $description..."
    log_debug "  URL: $url"
    log_debug "  Destination: $dest"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would download: $url -> $dest"
        return 0
    fi
    
    local dir
    dir="$(dirname "$dest")"
    mkdir -p "$dir"
    
    if command -v curl &>/dev/null; then
        if ! curl -fsSL --connect-timeout 30 --retry 3 "$url" -o "$dest"; then
            log_error "Download failed: $url"
            return 1
        fi
    elif command -v wget &>/dev/null; then
        if ! wget -q --timeout=30 --tries=3 -O "$dest" "$url"; then
            log_error "Download failed: $url"
            return 1
        fi
    else
        log_error "Neither curl nor wget found - cannot download files"
        return 1
    fi
    
    log_debug "Download complete: $dest ($(file_size "$dest"))"
    return 0
}

file_size() {
    local file="$1"
    if [[ -f "$file" ]]; then
        local size
        size=$(stat -f%z "$file" 2>/dev/null || stat -c%s "$file" 2>/dev/null || echo "0")
        human_size "$size"
    else
        echo "0 B"
    fi
}

human_size() {
    local bytes="$1"
    if [[ $bytes -ge 1073741824 ]]; then
        printf "%.2f GB" "$(echo "scale=2; $bytes/1073741824" | bc)"
    elif [[ $bytes -ge 1048576 ]]; then
        printf "%.2f MB" "$(echo "scale=2; $bytes/1048576" | bc)"
    elif [[ $bytes -ge 1024 ]]; then
        printf "%.2f KB" "$(echo "scale=2; $bytes/1024" | bc)"
    else
        printf "%d B" "$bytes"
    fi
}

verify_checksum() {
    local file="$1"
    local expected_sha256="$2"
    
    if [[ -z "$expected_sha256" ]]; then
        log_debug "No checksum provided, skipping verification"
        return 0
    fi
    
    log_info "Verifying checksum..."
    
    local actual_sha256
    if command -v sha256sum &>/dev/null; then
        actual_sha256=$(sha256sum "$file" | cut -d' ' -f1)
    elif command -v shasum &>/dev/null; then
        actual_sha256=$(shasum -a 256 "$file" | cut -d' ' -f1)
    else
        log_warn "No sha256sum or shasum available, skipping checksum verification"
        return 0
    fi
    
    if [[ "$actual_sha256" != "$expected_sha256" ]]; then
        log_error "Checksum mismatch!"
        log_error "  Expected: $expected_sha256"
        log_error "  Actual:   $actual_sha256"
        return 1
    fi
    
    log_info "Checksum verified: $actual_sha256"
    return 0
}

#=============================================================================
# JSON UTILITIES
#=============================================================================

json_available() {
    command -v python3 &>/dev/null || command -v jq &>/dev/null
}

json_get() {
    local json="$1"
    local key="$2"
    
    if command -v jq &>/dev/null; then
        echo "$json" | jq -r ".$key // empty" 2>/dev/null
    elif command -v python3 &>/dev/null; then
        python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('$key', ''))" <<<"$json" 2>/dev/null
    else
        echo ""
    fi
}

json_set_file() {
    local file="$1"
    local key_path="$2"
    local value="$3"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would set $key_path = $value in $file"
        return 0
    fi
    
    if command -v python3 &>/dev/null; then
        python3 - "$file" "$key_path" "$value" <<'PY'
import json, sys, os

file_path = sys.argv[1]
key_path = sys.argv[2]
value = sys.argv[3]

# Load existing or create new
data = {}
if os.path.exists(file_path):
    try:
        with open(file_path, 'r') as f:
            data = json.load(f)
    except:
        data = {}

# Parse key path (e.g., "Agent.ServerUrl")
keys = key_path.split('.')
current = data
for key in keys[:-1]:
    if key not in current or not isinstance(current[key], dict):
        current[key] = {}
    current = current[key]

# Set value (auto-convert booleans and numbers)
if value.lower() in ('true', 'false'):
    current[keys[-1]] = value.lower() == 'true'
elif value.isdigit():
    current[keys[-1]] = int(value)
else:
    try:
        current[keys[-1]] = float(value)
    except:
        current[keys[-1]] = value

with open(file_path, 'w') as f:
    json.dump(data, f, indent=2)
    f.write('\n')
PY
    elif command -v jq &>/dev/null; then
        local temp_file="${file}.tmp"
        local jq_path
        jq_path=$(echo "$key_path" | sed 's/\././g')
        
        if [[ -f "$file" ]]; then
            jq ".$jq_path = \"$value\"" "$file" > "$temp_file"
            mv "$temp_file" "$file"
        else
            echo "{}" | jq ".$jq_path = \"$value\"" > "$file"
        fi
    else
        log_error "No JSON processor available (python3 or jq required)"
        return 1
    fi
}

show_local_agent_versions() {
    local server_url="$1"
    local channel="${2:-}"
    local catalog_url="${server_url}/api/binaries/agent/release-catalog"

    if [[ -n "$channel" ]]; then
        catalog_url="${catalog_url}?channel=${channel}"
    fi

    local json=""
    if command -v curl &>/dev/null; then
        json=$(curl -fsSL "$catalog_url" --connect-timeout 10 2>/dev/null || true)
    elif command -v wget &>/dev/null; then
        json=$(wget -qO- "$catalog_url" --timeout=10 2>/dev/null || true)
    fi

    if [[ -z "$json" ]]; then
        log_warn "Unable to query local agent versions (no response)."
        return 0
    fi

    if command -v python3 &>/dev/null; then
        local output
        output=$(python3 - "$json" <<'PY'
import json,sys,datetime
data=json.loads(sys.argv[1])
local=data.get("local") or []
channel=data.get("channel") or ""
if not local:
    print(f"No local agent versions staged for channel '{channel}'.")
    sys.exit(0)
print(f"Local agent versions available (channel: {channel}):")
for item in local:
    version=item.get("version", "")
    rids=item.get("rids") or []
    ts=item.get("binaryLastWriteTimeUtc")
    stamp="unknown"
    if ts:
        try:
            stamp=datetime.datetime.fromisoformat(ts.replace("Z","+00:00")).strftime("%Y-%m-%d %H:%M:%SZ")
        except Exception:
            stamp=ts
    print(f"  - {version} [{', '.join(rids)}] (last updated: {stamp})")
PY
)
        while IFS= read -r line; do
            log_info "$line"
        done <<<"$output"
        return 0
    fi

    if command -v jq &>/dev/null; then
        local channel_label
        channel_label=$(echo "$json" | jq -r '.channel // ""' 2>/dev/null || echo "")
        local local_count
        local_count=$(echo "$json" | jq -r '.local | length' 2>/dev/null || echo "0")
        if [[ "$local_count" == "0" ]]; then
            log_info "No local agent versions staged for channel '$channel_label'."
            return 0
        fi
        log_info "Local agent versions available (channel: $channel_label):"
        echo "$json" | jq -r '.local[] | "  - \(.version) [\(.rids | join(", "))] (last updated: \(.binaryLastWriteTimeUtc // "unknown"))"' 2>/dev/null | while read -r line; do
            log_info "$line"
        done
        return 0
    fi

    log_info "Local agent versions available at: $catalog_url"
}

#=============================================================================
# FILE UTILITIES
#=============================================================================

backup_file() {
    local file="$1"
    if [[ -f "$file" ]]; then
        local backup="${file}.bak.$(date +%Y%m%d%H%M%S)"
        log_debug "Creating backup: $backup"
        cp -f "$file" "$backup"
        echo "$backup"
    fi
}

trim_trailing_slash() {
    local s="$1"
    while [[ "$s" == */ ]]; do s="${s%/}"; done
    printf '%s' "$s"
}

ensure_dir() {
    local dir="$1"
    local mode="${2:-0755}"
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would create directory: $dir (mode $mode)"
        return 0
    fi
    
    if [[ ! -d "$dir" ]]; then
        mkdir -p "$dir"
        chmod "$mode" "$dir"
    fi
}

safe_remove() {
    local path="$1"
    
    # Safety checks
    if [[ -z "$path" || "$path" == "/" || "$path" == "/*" ]]; then
        log_error "Refusing to remove unsafe path: $path"
        return 1
    fi
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would remove: $path"
        return 0
    fi
    
    if [[ -e "$path" ]]; then
        rm -rf "$path"
        log_debug "Removed: $path"
    fi
}

stop_agent_processes() {
    # Kill all running agent processes and wait for termination
    local timeout="${1:-10}"
    
    log_info "Stopping any running agent processes..."
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would stop agent processes"
        return 0
    fi
    
    # Kill processes by name
    if command -v pkill &>/dev/null; then
        pkill -x "$BIN_NAME" 2>/dev/null || true
    elif command -v killall &>/dev/null; then
        killall "$BIN_NAME" 2>/dev/null || true
    else
        # Fallback: find and kill by pid
        pgrep -x "$BIN_NAME" 2>/dev/null | while read -r pid; do
            log_debug "  Terminating process $pid..."
            kill -9 "$pid" 2>/dev/null || true
        done
    fi
    
    # Wait for processes to terminate
    local waited=0
    while [[ $waited -lt $timeout ]]; do
        if ! pgrep -x "$BIN_NAME" &>/dev/null; then
            break
        fi
        sleep 1
        ((waited++))
    done
    
    if [[ $waited -gt 0 ]]; then
        log_debug "Waited ${waited}s for agent processes to terminate"
    fi
}

remove_directory_with_retry() {
    # Remove a directory with retry logic for locked files
    local path="$1"
    local max_retries="${2:-3}"
    local retry_delay="${3:-1}"
    
    # Safety checks
    if [[ -z "$path" || "$path" == "/" || "$path" == "/*" ]]; then
        log_error "Refusing to remove unsafe path: $path"
        return 1
    fi
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would remove: $path"
        return 0
    fi
    
    if [[ ! -e "$path" ]]; then
        log_debug "Path does not exist: $path"
        return 0
    fi
    
    local i
    for ((i = 0; i < max_retries; i++)); do
        if rm -rf "$path" 2>/dev/null; then
            log_info "Removed directory: $path"
            return 0
        else
            if [[ $i -lt $((max_retries - 1)) ]]; then
                log_warn "Retry $((i + 1))/$max_retries: Failed to remove '$path', waiting ${retry_delay}s..."
                sleep "$retry_delay"
            else
                log_error "Failed to remove '$path' after $max_retries attempts"
                return 1
            fi
        fi
    done
}

#=============================================================================
# USER MANAGEMENT
#=============================================================================

create_system_user() {
    local username="$1"
    local os
    os="$(detect_os)"
    
    if id "$username" &>/dev/null; then
        log_debug "User $username already exists"
        return 0
    fi
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would create system user: $username"
        return 0
    fi
    
    log_info "Creating system user: $username"
    
    if [[ "$os" == "linux" ]]; then
        if command -v useradd &>/dev/null; then
            useradd --system --no-create-home --shell /usr/sbin/nologin "$username" 2>/dev/null || true
        elif command -v adduser &>/dev/null; then
            adduser --system --no-create-home --disabled-login "$username" 2>/dev/null || true
        else
            log_warn "Cannot create user - no useradd or adduser found"
            return 1
        fi
    elif [[ "$os" == "darwin" ]]; then
        if command -v dscl &>/dev/null; then
            # Find available UID in 400-499 range (system accounts)
            local next_uid=400
            while dscl . -list /Users UniqueID 2>/dev/null | awk '{print $2}' | grep -q "^${next_uid}$"; do
                ((next_uid++))
                [[ $next_uid -ge 500 ]] && break
            done
            
            if [[ $next_uid -lt 500 ]]; then
                dscl . -create "/Users/$username" 2>/dev/null || true
                dscl . -create "/Users/$username" UserShell /usr/bin/false 2>/dev/null || true
                dscl . -create "/Users/$username" UniqueID "$next_uid" 2>/dev/null || true
                dscl . -create "/Users/$username" PrimaryGroupID 20 2>/dev/null || true
                dscl . -create "/Users/$username" RealName "ManLab Agent" 2>/dev/null || true
                dscl . -create "/Users/$username" IsHidden 1 2>/dev/null || true
            else
                log_warn "No available UID in system range for macOS"
                return 1
            fi
        else
            log_warn "Cannot create user on macOS - dscl not found"
            return 1
        fi
    fi
    
    return 0
}

remove_system_user() {
    local username="$1"
    
    if ! id "$username" &>/dev/null; then
        log_debug "User $username does not exist"
        return 0
    fi
    
    if [[ "$DRY_RUN" -eq 1 ]]; then
        log_info "[DRY RUN] Would remove system user: $username"
        return 0
    fi
    
    log_info "Removing system user: $username"
    
    # Kill any running processes
    if command -v pkill &>/dev/null; then
        pkill -u "$username" 2>/dev/null || true
    fi
    
    local os
    os="$(detect_os)"
    
    if [[ "$os" == "linux" ]]; then
        if command -v userdel &>/dev/null; then
            userdel "$username" 2>/dev/null || true
        elif command -v deluser &>/dev/null; then
            deluser "$username" 2>/dev/null || true
        fi
        if command -v groupdel &>/dev/null; then
            groupdel "$username" 2>/dev/null || true
        fi
    elif [[ "$os" == "darwin" ]]; then
        if command -v dscl &>/dev/null; then
            dscl . -delete "/Users/$username" 2>/dev/null || true
        fi
    fi
}

#=============================================================================
# INTERACTIVE PROMPTS
#=============================================================================

INTERACTIVE="${INTERACTIVE:-0}"

confirm() {
    local message="$1"
    local default="${2:-n}"
    
    if [[ "$INTERACTIVE" -ne 1 ]]; then
        return 0
    fi
    
    local yn
    if [[ "$default" == "y" ]]; then
        read -rp "${message} [Y/n]: " yn
        yn="${yn:-y}"
    else
        read -rp "${message} [y/N]: " yn
        yn="${yn:-n}"
    fi
    
    case "$yn" in
        [Yy]*) return 0 ;;
        *)     return 1 ;;
    esac
}

prompt_value() {
    local message="$1"
    local default="${2:-}"
    local result
    
    if [[ -n "$default" ]]; then
        read -rp "${message} [$default]: " result
        result="${result:-$default}"
    else
        read -rp "${message}: " result
    fi
    
    echo "$result"
}

#=============================================================================
# CLEANUP & EXIT HANDLING
#=============================================================================

declare -a CLEANUP_PATHS=()
declare -a CLEANUP_FUNCS=()

register_cleanup() {
    local item="$1"
    local type="${2:-path}"
    
    if [[ "$type" == "func" ]]; then
        CLEANUP_FUNCS+=("$item")
    else
        CLEANUP_PATHS+=("$item")
    fi
}

run_cleanup() {
    log_debug "Running cleanup..."
    
    for func in "${CLEANUP_FUNCS[@]:-}"; do
        if [[ -n "$func" ]]; then
            "$func" 2>/dev/null || true
        fi
    done
    
    for path in "${CLEANUP_PATHS[@]:-}"; do
        if [[ -n "$path" && -e "$path" ]]; then
            rm -rf "$path" 2>/dev/null || true
        fi
    done
}

setup_trap() {
    trap 'run_cleanup' EXIT
    trap 'log_error "Interrupted"; exit 130' INT
    trap 'log_error "Terminated"; exit 143' TERM
}

#=============================================================================
# HEALTH CHECK
#=============================================================================

check_agent_running() {
    local init_system
    init_system="$(detect_init_system)"
    
    case "$init_system" in
        systemd)
            systemctl is-active --quiet "$SERVICE_NAME" 2>/dev/null
            ;;
        launchd)
            launchctl list 2>/dev/null | grep -q "com.manlab.agent"
            ;;
        *)
            pgrep -x "$BIN_NAME" &>/dev/null
            ;;
    esac
}

wait_for_agent() {
    local timeout="${1:-30}"
    local interval=2
    local elapsed=0
    
    log_info "Waiting for agent to start (timeout: ${timeout}s)..."
    
    while [[ $elapsed -lt $timeout ]]; do
        if check_agent_running; then
            log_info "Agent is running"
            return 0
        fi
        sleep "$interval"
        ((elapsed += interval))
    done
    
    log_warn "Agent did not start within ${timeout} seconds"
    return 1
}
