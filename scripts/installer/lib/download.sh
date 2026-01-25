#!/usr/bin/env bash
# ManLab Agent Installer - Download Module
# Handles agent binary downloads from server or GitHub releases

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
[[ -z "${COMMON_SOURCED:-}" ]] && source "$SCRIPT_DIR/common.sh"

#=============================================================================
# GITHUB RELEASE DOWNLOAD
#=============================================================================

get_github_release_info() {
    local server_url="$1"
    local info_url="${server_url}/api/binaries/agent/github-release-info"
    
    if command -v curl &>/dev/null; then
        curl -fsSL "$info_url" --connect-timeout 10 2>/dev/null || echo ""
    elif command -v wget &>/dev/null; then
        wget -qO- "$info_url" --timeout=10 2>/dev/null || echo ""
    else
        echo ""
    fi
}

try_download_from_github() {
    local server_url="$1" rid="$2" out_file="$3"
    local prefer_github="${PREFER_GITHUB:-}" base_url="${GITHUB_RELEASE_BASE_URL:-}" version="${GITHUB_VERSION:-}"
    
    # Check env vars as fallback
    [[ -z "$prefer_github" ]] && prefer_github="${MANLAB_PREFER_GITHUB_DOWNLOAD:-}"
    [[ -z "$base_url" ]] && base_url="${MANLAB_GITHUB_RELEASE_BASE_URL:-}"
    [[ -z "$version" ]] && version="${MANLAB_GITHUB_VERSION:-}"
    
    local archive_url="" binary_name="manlab-agent"
    
    # Explicit override takes precedence
    if [[ "$prefer_github" == "1" || "$prefer_github" == "true" ]] && [[ -n "$base_url" ]] && [[ -n "$version" ]]; then
        archive_url="${base_url%/}/${version}/manlab-agent-${rid}.tar.gz"
    else
        # Try to get info from server
        local release_info
        release_info="$(get_github_release_info "$server_url")"
        [[ -z "$release_info" ]] && return 1
        
        local enabled
        enabled=$(json_get "$release_info" "enabled")
        [[ "$enabled" != "true" ]] && return 1
        
        archive_url=$(echo "$release_info" | python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(d.get('downloadUrls',{}).get('$rid',{}).get('archiveUrl',''))" 2>/dev/null || echo "")
        [[ -z "$archive_url" ]] && return 1
    fi
    
    log_info "Attempting download from GitHub: $archive_url"
    
    local temp_dir
    temp_dir="$(mktemp -d)"
    register_cleanup "$temp_dir"
    
    local archive_path="$temp_dir/agent.tar.gz"
    if download_file "$archive_url" "$archive_path" "GitHub archive"; then
        log_info "Extracting archive..."
        if tar -xzf "$archive_path" -C "$temp_dir"; then
            local extracted
            extracted="$(find "$temp_dir" -type f -name "$binary_name" -print -quit 2>/dev/null || true)"
            if [[ -n "$extracted" && -f "$extracted" ]]; then
                cp -f "$extracted" "$out_file"
                chmod +x "$out_file"
                log_info "Downloaded from GitHub successfully"
                return 0
            fi
        fi
    fi
    
    log_warn "GitHub download failed, falling back to server"
    return 1
}

#=============================================================================
# SERVER DOWNLOAD
#=============================================================================

download_agent_binary() {
    local server_url="$1" rid="$2" out_file="$3"
    local checksum="${4:-}"
    local channel="${5:-}" version="${6:-}"
    
    # Try GitHub first if enabled
    if try_download_from_github "$server_url" "$rid" "$out_file"; then
        return 0
    fi
    
    # Fall back to server
    local bin_url="${server_url}/api/binaries/agent/${rid}"
    local sep="?"
    if [[ -n "$channel" ]]; then
        bin_url="${bin_url}${sep}channel=${channel}"
        sep="&"
    fi
    if [[ -n "$version" ]]; then
        bin_url="${bin_url}${sep}version=${version}"
        sep="&"
    fi
    log_info "Downloading agent from server: $bin_url"
    
    if ! download_file "$bin_url" "$out_file" "agent binary"; then
        log_error "Failed to download agent binary"
        return 1
    fi
    
    chmod +x "$out_file"
    
    # Verify checksum if provided
    if [[ -n "$checksum" ]]; then
        if ! verify_checksum "$out_file" "$checksum"; then
            rm -f "$out_file"
            return 1
        fi
    fi
    
    return 0
}

download_appsettings() {
    local server_url="$1" rid="$2" out_file="$3"
    local channel="${4:-}" version="${5:-}"
    local url="${server_url}/api/binaries/agent/${rid}/appsettings.json"
    local sep="?"
    if [[ -n "$channel" ]]; then
        url="${url}${sep}channel=${channel}"
        sep="&"
    fi
    if [[ -n "$version" ]]; then
        url="${url}${sep}version=${version}"
        sep="&"
    fi
    
    log_info "Downloading appsettings.json..."
    if download_file "$url" "$out_file" "appsettings.json"; then
        return 0
    else
        log_warn "appsettings.json not found on server (continuing)"
        return 1
    fi
}

export -f get_github_release_info try_download_from_github
export -f download_agent_binary download_appsettings
