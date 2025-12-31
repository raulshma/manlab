#Requires -Version 5.1
<#
.SYNOPSIS
    ManLab Agent Installer - Common PowerShell Module
.DESCRIPTION
    Shared utilities for Windows installation scripts including logging,
    validation, download, and configuration management.
#>

$script:ScriptVersion = "2.0.0"
$script:DefaultInstallDir = "C:\ProgramData\ManLab\Agent"
$script:ServiceName = "ManLab Agent"
$script:BinName = "manlab-agent.exe"

#region Logging

$script:LogLevel = if ($env:LOG_LEVEL) { $env:LOG_LEVEL } else { "INFO" }
$script:DryRun = [bool]::Parse((if ($env:DRY_RUN) { $env:DRY_RUN } else { "false" })) -or $WhatIfPreference

function Write-Log {
    param(
        [Parameter(Mandatory)][string]$Message,
        [ValidateSet("DEBUG","INFO","WARN","ERROR")][string]$Level = "INFO"
    )
    
    $levelOrder = @{ DEBUG = 0; INFO = 1; WARN = 2; ERROR = 3 }
    $configLevel = if ($levelOrder.ContainsKey($script:LogLevel)) { $levelOrder[$script:LogLevel] } else { 1 }
    $msgLevel = if ($levelOrder.ContainsKey($Level)) { $levelOrder[$Level] } else { 1 }
    
    if ($msgLevel -lt $configLevel) { return }
    
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $color = switch ($Level) {
        "DEBUG" { "Cyan" }
        "INFO"  { "Green" }
        "WARN"  { "Yellow" }
        "ERROR" { "Red" }
    }
    
    Write-Host "[$timestamp] $Level : $Message" -ForegroundColor $color
}

function Write-Debug { param([string]$Message) Write-Log $Message "DEBUG" }
function Write-Info { param([string]$Message) Write-Log $Message "INFO" }
function Write-Warn { param([string]$Message) Write-Log $Message "WARN" }
function Write-Err { param([string]$Message) Write-Log $Message "ERROR" }

#endregion

#region Validation

function Test-IsAdmin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Assert-Admin {
    if (-not (Test-IsAdmin)) {
        throw "This installer requires administrator privileges. Run as Administrator."
    }
}

function Test-ValidUrl {
    param([string]$Url, [string]$Name = "URL")
    
    if ([string]::IsNullOrWhiteSpace($Url)) {
        Write-Err "$Name is required"
        return $false
    }
    if (-not ($Url -match '^https?://')) {
        Write-Err "$Name must start with http:// or https://"
        return $false
    }
    return $true
}

#endregion

#region OS Detection

function Get-RuntimeId {
    $arch = $env:PROCESSOR_ARCHITECTURE
    $arch2 = $env:PROCESSOR_ARCHITEW6432
    $effective = if ($arch2) { $arch2 } else { $arch }
    
    switch -Regex ($effective) {
        'ARM64' { return 'win-arm64' }
        'AMD64|x86_64' { return 'win-x64' }
        default { throw "Unsupported architecture: $effective" }
    }
}

#endregion

#region Download

function Get-FileWithProgress {
    param(
        [Parameter(Mandatory)][string]$Url,
        [Parameter(Mandatory)][string]$OutFile,
        [string]$Description = "file"
    )
    
    Write-Info "Downloading $Description..."
    Write-Debug "  URL: $Url"
    Write-Debug "  Dest: $OutFile"
    
    if ($script:DryRun) {
        Write-Info "[DRY RUN] Would download: $Url -> $OutFile"
        return $true
    }
    
    $dir = Split-Path -Parent $OutFile
    if (-not (Test-Path $dir)) {
        New-Item -ItemType Directory -Path $dir -Force | Out-Null
    }
    
    try {
        $webClient = [System.Net.WebClient]::new()
        $webClient.DownloadFile($Url, $OutFile)
        $webClient.Dispose()
        
        $size = (Get-Item $OutFile).Length
        Write-Debug "Downloaded: $OutFile ($([math]::Round($size/1MB, 2)) MB)"
        return $true
    }
    catch {
        Write-Err "Download failed: $($_.Exception.Message)"
        return $false
    }
}

function Test-Checksum {
    param(
        [Parameter(Mandatory)][string]$File,
        [string]$ExpectedSha256
    )
    
    if ([string]::IsNullOrWhiteSpace($ExpectedSha256)) {
        Write-Debug "No checksum provided, skipping verification"
        return $true
    }
    
    Write-Info "Verifying checksum..."
    $actualHash = (Get-FileHash -Path $File -Algorithm SHA256).Hash
    
    if ($actualHash -ne $ExpectedSha256) {
        Write-Err "Checksum mismatch!"
        Write-Err "  Expected: $ExpectedSha256"
        Write-Err "  Actual:   $actualHash"
        return $false
    }
    
    Write-Info "Checksum verified"
    return $true
}

#endregion

#region Configuration

function Update-AppSettings {
    param(
        [Parameter(Mandatory)][string]$Path,
        [hashtable]$Settings
    )
    
    if ($script:DryRun) {
        Write-Info "[DRY RUN] Would update: $Path"
        return
    }
    
    $obj = @{}
    if (Test-Path $Path) {
        try {
            $raw = Get-Content -Path $Path -Raw -ErrorAction Stop
            if (-not [string]::IsNullOrWhiteSpace($raw)) {
                $obj = $raw | ConvertFrom-Json -AsHashtable -ErrorAction Stop
            }
        } catch {
            Write-Warn "Existing config invalid, creating new"
            $obj = @{}
        }
    }
    
    if (-not $obj.ContainsKey('Agent')) {
        $obj['Agent'] = @{}
    }
    
    foreach ($key in $Settings.Keys) {
        $value = $Settings[$key]
        if ($null -ne $value -and $value -ne '') {
            $obj['Agent'][$key] = $value
        }
    }
    
    $obj | ConvertTo-Json -Depth 20 | Set-Content -Path $Path -Encoding UTF8
    Write-Debug "Updated: $Path"
}

#endregion

#region File Utilities

function Remove-SafePath {
    param(
        [string]$Path,
        [int]$MaxRetries = 3,
        [int]$RetryDelaySeconds = 1
    )
    
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    if ($Path -eq 'C:\' -or $Path -eq 'C:') {
        Write-Err "Refusing to remove unsafe path: $Path"
        return
    }
    
    if ($script:DryRun) {
        Write-Info "[DRY RUN] Would remove: $Path"
        return
    }
    
    if (-not (Test-Path $Path)) {
        Write-Debug "Path does not exist: $Path"
        return
    }
    
    # Retry loop for locked files
    for ($i = 0; $i -lt $MaxRetries; $i++) {
        try {
            Remove-Item -Path $Path -Recurse -Force -ErrorAction Stop
            Write-Debug "Removed: $Path"
            return
        } catch {
            if ($i -lt $MaxRetries - 1) {
                Write-Warn "Retry $($i + 1)/$MaxRetries: Failed to remove '$Path', waiting ${RetryDelaySeconds}s..."
                Start-Sleep -Seconds $RetryDelaySeconds
            } else {
                Write-Err "Failed to remove '$Path' after $MaxRetries attempts: $_"
                throw $_
            }
        }
    }
}

function Backup-File {
    param([string]$Path)
    
    if (Test-Path $Path) {
        $backup = "$Path.bak.$(Get-Date -Format 'yyyyMMddHHmmss')"
        Copy-Item -Path $Path -Destination $backup -Force
        Write-Debug "Backup created: $backup"
        return $backup
    }
    return $null
}

#endregion

Export-ModuleMember -Function @(
    'Write-Log', 'Write-Debug', 'Write-Info', 'Write-Warn', 'Write-Err',
    'Test-IsAdmin', 'Assert-Admin', 'Test-ValidUrl',
    'Get-RuntimeId',
    'Get-FileWithProgress', 'Test-Checksum',
    'Update-AppSettings',
    'Remove-SafePath', 'Backup-File'
) -Variable @(
    'ScriptVersion', 'DefaultInstallDir', 'ServiceName', 'BinName', 'DryRun'
)
