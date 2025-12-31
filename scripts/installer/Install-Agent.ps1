#Requires -Version 5.1
<#
.SYNOPSIS
    ManLab Agent Installer for Windows
.DESCRIPTION
    Installs the ManLab Agent with Task Scheduler service registration.
.EXAMPLE
    .\Install-Agent.ps1 -Server http://manlab:5247 -AuthToken "token"
.EXAMPLE
    .\Install-Agent.ps1 -Server http://manlab:5247 -Interactive
.EXAMPLE
    .\Install-Agent.ps1 -Uninstall
#>

[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Server,
    [string]$AuthToken,
    [string]$InstallDir,
    [string]$TaskName,
    [string]$Rid,
    [switch]$Force,
    [switch]$Uninstall,
    [switch]$UninstallAll,
    [switch]$PreviewUninstall,
    [switch]$UserMode,
    [switch]$Interactive,
    [switch]$HealthCheck,
    [switch]$VerifyChecksum,
    [string]$Checksum,
    [string]$ConfigFile,
    
    # Remote tools
    [string]$EnableLogViewer,
    [string]$EnableScripts,
    [string]$EnableTerminal,
    [string]$EnableFileBrowser,
    
    # Telemetry
    [string]$EnableNetworkTelemetry,
    [string]$EnablePingTelemetry,
    [string]$EnableGpuTelemetry,
    [string]$EnableUpsTelemetry,
    [string]$EnableEnhancedNetworkTelemetry,
    [string]$EnableEnhancedGpuTelemetry,
    [string]$EnableApmTelemetry,
    
    # Agent settings
    [int]$HeartbeatIntervalSeconds = 15,
    [int]$MaxReconnectDelaySeconds = 60,
    [string]$PrimaryInterface,
    [string]$PingTarget,
    [int]$PingTimeoutMs = 800,
    
    # GitHub
    [switch]$PreferGitHub,
    [string]$GitHubReleaseBaseUrl,
    [string]$GitHubVersion
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$ScriptDir = $PSScriptRoot
Import-Module "$ScriptDir\lib\Common.psm1" -Force
Import-Module "$ScriptDir\lib\TaskScheduler.psm1" -Force

# Apply WhatIf to module
if ($WhatIfPreference) { $script:DryRun = $true }

#region Defaults

if ([string]::IsNullOrWhiteSpace($InstallDir)) {
    $InstallDir = if ($UserMode) { "$env:LOCALAPPDATA\ManLab\Agent" } else { $script:DefaultInstallDir }
}

if ([string]::IsNullOrWhiteSpace($TaskName)) {
    $TaskName = if ($UserMode) { $script:TaskNameUser } else { $script:TaskName }
}

#endregion

#region Preview Uninstall

if ($PreviewUninstall) {
    $sections = @()
    
    # Tasks
    $taskItems = Get-TaskInventory
    $sections += @{ label = "Scheduled Tasks"; items = @($taskItems) }
    
    # Directories
    $dirs = @($script:DefaultInstallDir)
    if ($env:LOCALAPPDATA) { $dirs += "$env:LOCALAPPDATA\ManLab\Agent" }
    $existingDirs = @($dirs | Where-Object { Test-Path $_ })
    $sections += @{ label = "Directories"; items = @($existingDirs) }
    
    @{ success = $true; osHint = "Windows"; sections = $sections; notes = @(); error = $null } | ConvertTo-Json -Depth 6
    exit 0
}

#endregion

#region Uninstall

function Invoke-Uninstall {
    param([string]$ThisTaskName, [string]$ThisInstallDir, [bool]$ThisUserMode)
    
    Write-Info "Uninstalling ManLab Agent"
    Write-Info "  Task: $ThisTaskName"
    Write-Info "  Dir:  $ThisInstallDir"
    
    Remove-AgentTask -Name $ThisTaskName
    
    if ($ThisUserMode) {
        Remove-UserAutostart -Name $ThisTaskName
    }
    
    Remove-SafePath -Path $ThisInstallDir
    
    Write-Info "Uninstall complete"
}

if ($Uninstall) {
    if (-not $UserMode) { Assert-Admin }
    
    if ($UninstallAll) {
        if (Test-IsAdmin) {
            Invoke-Uninstall -ThisTaskName $script:TaskName -ThisInstallDir $script:DefaultInstallDir -ThisUserMode $false
        }
        if ($env:LOCALAPPDATA) {
            Invoke-Uninstall -ThisTaskName $script:TaskNameUser -ThisInstallDir "$env:LOCALAPPDATA\ManLab\Agent" -ThisUserMode $true
        }
    } else {
        Invoke-Uninstall -ThisTaskName $TaskName -ThisInstallDir $InstallDir -ThisUserMode $UserMode
    }
    exit 0
}

#endregion

#region Install

# Validate
if (-not $UserMode) { Assert-Admin }

if ([string]::IsNullOrWhiteSpace($Server)) {
    $Server = if ($env:MANLAB_SERVER_BASE_URL) { $env:MANLAB_SERVER_BASE_URL } else { $env:MANLAB_SERVER }
}
if ([string]::IsNullOrWhiteSpace($AuthToken)) {
    $AuthToken = if ($env:MANLAB_ENROLLMENT_TOKEN) { $env:MANLAB_ENROLLMENT_TOKEN } else { $env:MANLAB_AUTH_TOKEN }
}

if (-not (Test-ValidUrl -Url $Server -Name "Server")) {
    throw "Server URL is required. Use -Server or set MANLAB_SERVER_BASE_URL"
}

$Server = $Server.TrimEnd('/')
$hubUrl = "$Server/hubs/agent"

if (-not $Rid) { $Rid = Get-RuntimeId }

$exePath = Join-Path $InstallDir 'manlab-agent.exe'
$appSettingsPath = Join-Path $InstallDir 'appsettings.json'
$configPath = Join-Path $InstallDir 'agent-config.json'
$runnerPath = Join-Path $InstallDir 'run-agent.ps1'
$logPath = Join-Path $InstallDir 'agent.log'

Write-Info "Installing ManLab Agent"
Write-Info "  Server:  $Server"
Write-Info "  Hub URL: $hubUrl"
Write-Info "  RID:     $Rid"
Write-Info "  Dir:     $InstallDir"
Write-Info "  Mode:    $(if ($UserMode) { 'User' } else { 'System' })"

# Interactive confirmation
if ($Interactive) {
    $confirm = Read-Host "Proceed with installation? [Y/n]"
    if ($confirm -eq 'n' -or $confirm -eq 'N') {
        Write-Info "Installation cancelled"
        exit 0
    }
}

# Check existing
if ((Test-Path $exePath) -and -not $Force) {
    throw "Agent exists at $exePath. Use -Force to overwrite."
}

# Create directory
if (-not (Test-Path $InstallDir)) {
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
}

# Download binary
$binUrl = "$Server/api/binaries/agent/$Rid"
Write-Info "Downloading agent binary..."
if (-not (Get-FileWithProgress -Url $binUrl -OutFile $exePath -Description "agent binary")) {
    throw "Failed to download agent binary"
}

if ($VerifyChecksum -and $Checksum) {
    if (-not (Test-Checksum -File $exePath -ExpectedSha256 $Checksum)) {
        Remove-Item $exePath -Force
        throw "Checksum verification failed"
    }
}

# Download/update appsettings.json
try {
    $appSettingsUrl = "$Server/api/binaries/agent/$Rid/appsettings.json"
    if (-not (Test-Path $appSettingsPath) -or $Force) {
        Get-FileWithProgress -Url $appSettingsUrl -OutFile $appSettingsPath -Description "appsettings.json" | Out-Null
    }
} catch {
    Write-Warn "appsettings.json not found on server (continuing)"
}

# Update configuration
$settings = @{
    ServerUrl = $hubUrl
    HeartbeatIntervalSeconds = $HeartbeatIntervalSeconds
    MaxReconnectDelaySeconds = $MaxReconnectDelaySeconds
}

if (-not [string]::IsNullOrWhiteSpace($AuthToken)) { $settings['AuthToken'] = $AuthToken }
if (-not [string]::IsNullOrWhiteSpace($EnableLogViewer)) { $settings['EnableLogViewer'] = [bool]::Parse($EnableLogViewer) }
if (-not [string]::IsNullOrWhiteSpace($EnableScripts)) { $settings['EnableScripts'] = [bool]::Parse($EnableScripts) }
if (-not [string]::IsNullOrWhiteSpace($EnableTerminal)) { $settings['EnableTerminal'] = [bool]::Parse($EnableTerminal) }
if (-not [string]::IsNullOrWhiteSpace($EnableFileBrowser)) { $settings['EnableFileBrowser'] = [bool]::Parse($EnableFileBrowser) }
if (-not [string]::IsNullOrWhiteSpace($PrimaryInterface)) { $settings['PrimaryInterfaceName'] = $PrimaryInterface }
if (-not [string]::IsNullOrWhiteSpace($PingTarget)) { $settings['PingTarget'] = $PingTarget }
if ($PingTimeoutMs -ne 800) { $settings['PingTimeoutMs'] = $PingTimeoutMs }

Update-AppSettings -Path $appSettingsPath -Settings $settings

# Write runner config
$runnerConfig = @{
    ServerUrl = $hubUrl
    AuthToken = $AuthToken
    LogPath = $logPath
    HeartbeatIntervalSeconds = $HeartbeatIntervalSeconds
    MaxReconnectDelaySeconds = $MaxReconnectDelaySeconds
}
$runnerConfig | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8

# Write runner script
$runnerScript = @'
$ErrorActionPreference = 'Stop'
$configPath = Join-Path $PSScriptRoot 'agent-config.json'
$config = Get-Content $configPath -Raw | ConvertFrom-Json
$env:MANLAB_SERVER_URL = $config.ServerUrl
if ($config.AuthToken) { $env:MANLAB_AUTH_TOKEN = $config.AuthToken }
$exe = Join-Path $PSScriptRoot 'manlab-agent.exe'
if (-not $logPath) { $logPath = Join-Path $PSScriptRoot 'agent.log' }
"[$(Get-Date -Format o)] Starting ManLab Agent" | Add-Content $logPath
& cmd.exe /d /c "`"$exe`" >> `"$logPath`" 2>&1"
'@
$runnerScript | Set-Content -Path $runnerPath -Encoding UTF8

# Create scheduled task
$taskCreated = $false
if ($UserMode) {
    $taskCreated = New-AgentUserTask -Name $TaskName -RunnerPath $runnerPath
} else {
    $taskCreated = New-AgentSystemTask -Name $TaskName -RunnerPath $runnerPath
}

if ($taskCreated) {
    Start-AgentTask -Name $TaskName | Out-Null
}

# Health check
if ($HealthCheck) {
    Write-Info "Waiting for agent to start..."
    Start-Sleep -Seconds 5
    $status = Get-AgentTaskStatus -Name $TaskName
    if ($status -eq 'running') {
        Write-Info "Agent is running"
    } else {
        Write-Warn "Agent may not have started correctly (status: $status)"
    }
}

Write-Info ""
Write-Info "Installation complete!"
Write-Info "Logs: $logPath"
Write-Info "To uninstall: .\Install-Agent.ps1 -Uninstall$(if ($UserMode) { ' -UserMode' })"

#endregion
