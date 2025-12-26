<#
.SYNOPSIS
  ManLab Agent installer (Windows)

.DESCRIPTION
  Downloads the staged ManLab.Agent native binary from the ManLab Server and
  registers it to run at startup via Windows Task Scheduler (runs as SYSTEM).

  This script avoids Windows Service registration because a console app is not
  a true Windows service.

.EXAMPLE
  .\install.ps1 -Server http://localhost:5247 -AuthToken "..." -Force

.PARAMETER Server
  Base URL to ManLab Server (e.g. http://localhost:5247)

.PARAMETER AuthToken
  Optional auth token used for the SignalR connection.

.PARAMETER InstallDir
  Install directory (default: C:\ProgramData\ManLab\Agent)

.PARAMETER TaskName
  Scheduled task name (default: ManLab Agent)

.PARAMETER Rid
  Override runtime identifier (default: auto-detected win-x64/win-arm64)

.PARAMETER Force
  Overwrite existing files and re-register scheduled task
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [string]$Server,

  [Parameter(Mandatory = $false)]
  [string]$AuthToken,

  [Parameter(Mandatory = $false)]
  [string]$InstallDir = "C:\ProgramData\ManLab\Agent",

  [Parameter(Mandatory = $false)]
  [string]$TaskName = "ManLab Agent",

  [Parameter(Mandatory = $false)]
  [string]$Rid,

  [Parameter(Mandatory = $false)]
  [switch]$Force
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Trim-TrailingSlash([string]$s) {
  while ($s.EndsWith('/')) { $s = $s.Substring(0, $s.Length - 1) }
  return $s
}

function Assert-Admin {
  $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw "Please run this installer from an elevated PowerShell (Run as Administrator)."
  }
}

function Detect-Rid {
  # Best-effort architecture detection for PowerShell 5.1+
  $arch = $env:PROCESSOR_ARCHITECTURE
  $arch2 = $env:PROCESSOR_ARCHITEW6432

  $effective = if ($arch2) { $arch2 } else { $arch }
  switch -Regex ($effective) {
    'ARM64' { return 'win-arm64' }
    'AMD64|x86_64' { return 'win-x64' }
    default { throw "Unsupported architecture: $effective" }
  }
}

function Download-File([string]$Url, [string]$OutFile) {
  $dir = Split-Path -Parent $OutFile
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  # -UseBasicParsing is needed on Windows PowerShell 5.1
  Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing
}

Assert-Admin

$Server = Trim-TrailingSlash $Server
$hubUrl = "$Server/hubs/agent"

if (-not $Rid) {
  $Rid = Detect-Rid
}

$apiBase = "$Server/api/binaries"
$binUrl = "$apiBase/agent/$Rid"
$appSettingsUrl = "$apiBase/agent/$Rid/appsettings.json"

$exePath = Join-Path $InstallDir 'manlab-agent.exe'
$appSettingsPath = Join-Path $InstallDir 'appsettings.json'
$configPath = Join-Path $InstallDir 'agent-config.json'
$runnerPath = Join-Path $InstallDir 'run-agent.ps1'
$logPath = Join-Path $InstallDir 'agent.log'

Write-Host "Installing ManLab Agent"
Write-Host "  Server:      $Server"
Write-Host "  Hub URL:     $hubUrl"
Write-Host "  RID:         $Rid"
Write-Host "  Install dir: $InstallDir"

if ((Test-Path $exePath) -and (-not $Force)) {
  throw "Agent already exists at $exePath. Re-run with -Force to overwrite."
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

Write-Host "Downloading agent binary: $binUrl"
Download-File -Url $binUrl -OutFile $exePath

# appsettings.json is optional; keep existing unless -Force
try {
  if ((-not (Test-Path $appSettingsPath)) -or $Force) {
    Write-Host "Downloading appsettings.json: $appSettingsUrl"
    Download-File -Url $appSettingsUrl -OutFile $appSettingsPath
  } else {
    Write-Host "Leaving existing appsettings.json in place (use -Force to overwrite)."
  }
} catch {
  Write-Warning "appsettings.json not found on server for $Rid (continuing)."
}

# Write config used by the runner
$config = [ordered]@{
  ServerUrl = $hubUrl
  AuthToken = $AuthToken
  LogPath = $logPath
}
$config | ConvertTo-Json -Depth 5 | Set-Content -Path $configPath -Encoding UTF8

# Write runner script
$runner = @'
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$configPath = Join-Path $PSScriptRoot 'agent-config.json'
if (-not (Test-Path $configPath)) {
  throw "Missing config file: $configPath"
}

$config = Get-Content -Path $configPath -Raw | ConvertFrom-Json

if ($null -eq $config.ServerUrl -or [string]::IsNullOrWhiteSpace([string]$config.ServerUrl)) {
  throw "agent-config.json missing ServerUrl"
}

$env:MANLAB_SERVER_URL = [string]$config.ServerUrl

if ($null -ne $config.AuthToken -and -not [string]::IsNullOrWhiteSpace([string]$config.AuthToken)) {
  $env:MANLAB_AUTH_TOKEN = [string]$config.AuthToken
}

$exe = Join-Path $PSScriptRoot 'manlab-agent.exe'
if (-not (Test-Path $exe)) {
  throw "Missing agent binary: $exe"
}

$logPath = if ($null -ne $config.LogPath -and -not [string]::IsNullOrWhiteSpace([string]$config.LogPath)) {
  [string]$config.LogPath
} else {
  Join-Path $PSScriptRoot 'agent.log'
}

# Ensure log directory exists
$logDir = Split-Path -Parent $logPath
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir -Force | Out-Null }

"[$(Get-Date -Format o)] Starting ManLab Agent" | Add-Content -Path $logPath -Encoding UTF8

# Run in foreground so the scheduled task stays alive.
& $exe 1>> $logPath 2>> $logPath
'@

$runner | Set-Content -Path $runnerPath -Encoding UTF8

# Register scheduled task
# Use schtasks.exe for maximum compatibility.
$taskExists = $false
try {
  schtasks /Query /TN "$TaskName" | Out-Null
  $taskExists = $true
} catch {
  $taskExists = $false
}

if ($taskExists) {
  if (-not $Force) {
    throw "Scheduled task '$TaskName' already exists. Re-run with -Force to recreate."
  }

  Write-Host "Removing existing scheduled task: $TaskName"
  schtasks /Delete /TN "$TaskName" /F | Out-Null
}

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`""

Write-Host "Creating scheduled task: $TaskName"
# Run as SYSTEM at startup
schtasks /Create /TN "$TaskName" /TR "$taskCommand" /SC ONSTART /RU "SYSTEM" /RL HIGHEST /F | Out-Null

Write-Host "Starting scheduled task: $TaskName"
schtasks /Run /TN "$TaskName" | Out-Null

Write-Host "Installed. Logs will be written to: $logPath"
Write-Host "To remove: schtasks /Delete /TN `"$TaskName`" /F and delete $InstallDir"
