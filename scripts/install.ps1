<#
.SYNOPSIS
  ManLab Agent installer (Windows)

.DESCRIPTION
  Downloads the staged ManLab.Agent native binary from the ManLab Server and
  registers it to run at startup via Windows Task Scheduler.

  By default, this script requires administrator privileges and installs to
  C:\ProgramData (runs as SYSTEM at startup).

  Use -UserMode to install without admin privileges to %LOCALAPPDATA%
  (runs as current user on logon).

  This script avoids Windows Service registration because a console app is not
  a true Windows service.

.EXAMPLE
  # From the repo root:
  .\scripts\install.ps1 -Server http://localhost:5247 -AuthToken "..." -Force

.PARAMETER Server
  Base URL to ManLab Server (e.g. http://localhost:5247)

.PARAMETER AuthToken
  Optional auth token used for the SignalR connection.

.PARAMETER InstallDir
  Install directory (default: C:\ProgramData\ManLab\Agent for admin mode,
  %LOCALAPPDATA%\ManLab\Agent for user mode)

.PARAMETER UserMode
  Install without admin privileges to user-local directory.
  Agent will run as current user on logon instead of SYSTEM at startup.

.PARAMETER TaskName
  Scheduled task name (default: ManLab Agent)

.PARAMETER Rid
  Override runtime identifier (default: auto-detected win-x64/win-arm64)

.PARAMETER Force
  Overwrite existing files and re-register scheduled task

.PARAMETER Uninstall
  Removes the scheduled task and deletes the install directory.
#>

[CmdletBinding()]
param(
  [Parameter(Mandatory = $false)]
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
  [switch]$Force,

  [Parameter(Mandatory = $false)]
  [switch]$Uninstall,

  [Parameter(Mandatory = $false)]
  [switch]$UninstallAll,

  [Parameter(Mandatory = $false)]
  [switch]$PreviewUninstall,

  [Parameter(Mandatory = $false)]
  [switch]$UserMode,

  [Parameter(Mandatory = $false)]
  [int]$HeartbeatIntervalSeconds = 10,

  [Parameter(Mandatory = $false)]
  [int]$MaxReconnectDelaySeconds = 120,

  # Remote tools (default-deny; security-sensitive). Use these to explicitly enable tools
  # during automated installs (e.g., dashboard SSH provisioning). Values are strings so
  # they can be omitted (tri-state) without implicitly forcing false.
  [Parameter(Mandatory = $false)]
  [string]$EnableLogViewer,

  [Parameter(Mandatory = $false)]
  [string]$EnableScripts,

  [Parameter(Mandatory = $false)]
  [string]$EnableTerminal,

  [Parameter(Mandatory = $false)]
  [string]$EnableFileBrowser,

  # Optional: force the installer to download the agent from GitHub Releases.
  # This bypasses the server's /api/binaries staging when you want the official release assets.
  # Example base URL: https://github.com/owner/repo/releases/download
  [Parameter(Mandatory = $false)]
  [string]$GitHubReleaseBaseUrl,

  # Example version: v0.0.1-alpha
  [Parameter(Mandatory = $false)]
  [string]$GitHubVersion,

  [Parameter(Mandatory = $false)]
  [switch]$PreferGitHub
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function New-PreviewSection([string]$Label, [string[]]$Items) {
  return @{ label = $Label; items = @($Items | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }) }
}

function Get-DirectoryFileSample([string]$Path, [int]$Max = 20) {
  try {
    if (-not (Test-Path $Path)) { return @() }
    return Get-ChildItem -Path $Path -File -Recurse -Force -ErrorAction Stop |
      Select-Object -First $Max -ExpandProperty FullName
  } catch {
    return @()
  }
}

function Get-TaskMatches {
  $matches = @()
  try {
    $tasks = Get-ScheduledTask -ErrorAction Stop

    foreach ($t in $tasks) {
      $name = $t.TaskName
      $path = $t.TaskPath

      $isNameMatch = $false
      if ($name -like '*ManLab*' -or $name -like '*manlab*' -or $name -like '*Agent*') { $isNameMatch = $true }

      $actionMatch = $false
      try {
        foreach ($a in ($t.Actions | Where-Object { $_ -ne $null })) {
          $exe = $a.Execute
          $args = $a.Arguments
          if (($exe -match 'manlab-agent' -or $exe -match 'run-agent') -or ($args -match 'manlab-agent' -or $args -match 'run-agent')) {
            $actionMatch = $true
          }
        }
      } catch {
        # ignore action parsing issues
      }

      if ($isNameMatch -or $actionMatch) {
        $full = if ($path -and $path -ne '\') { "$path$name" } else { $name }
        $matches += $full
      }
    }
  } catch {
    # Fallback: schtasks summary (best-effort)
    try {
      $raw = schtasks /Query /FO LIST /V 2>$null
      if ($LASTEXITCODE -eq 0 -and $raw) {
        # Pull out task names that mention ManLab or manlab-agent.
        $current = $null
        foreach ($line in $raw) {
          if ($line -match '^TaskName:\s*(.+)$') {
            $current = $Matches[1].Trim()
          }
          if ($current -and ($line -match 'ManLab' -or $line -match 'manlab-agent' -or $line -match 'run-agent')) {
            $matches += $current
            $current = $null
          }
        }
      }
    } catch {
      # ignore
    }
  }

  return @($matches | Sort-Object -Unique)
}

if ($PreviewUninstall) {
  $sections = @()
  $notes = @()

  # Services (legacy)
  try {
    $svc = Get-Service -Name 'manlab-agent' -ErrorAction SilentlyContinue
    if ($svc) {
      $sections += (New-PreviewSection -Label 'Services' -Items @("manlab-agent (state: $($svc.Status))"))
    } else {
      $sections += (New-PreviewSection -Label 'Services' -Items @('manlab-agent (if present)'))
    }
  } catch {
    $sections += (New-PreviewSection -Label 'Services' -Items @('manlab-agent (if present)'))
  }

  # Scheduled tasks
  $taskMatches = Get-TaskMatches
  if ($taskMatches.Count -gt 0) {
    $sections += (New-PreviewSection -Label 'Scheduled tasks' -Items $taskMatches)
  } else {
    $sections += (New-PreviewSection -Label 'Scheduled tasks' -Items @('ManLab Agent (if present)', 'ManLab Agent User (if present)'))
  }

  # Directories + file sample
  $dirs = @('C:\ProgramData\ManLab\Agent')
  if ($env:LOCALAPPDATA) { $dirs += (Join-Path $env:LOCALAPPDATA 'ManLab\Agent') }
  $existingDirs = @($dirs | Where-Object { Test-Path $_ })
  if ($existingDirs.Count -gt 0) {
    $sections += (New-PreviewSection -Label 'Directories' -Items $existingDirs)
    foreach ($d in $existingDirs) {
      $files = Get-DirectoryFileSample -Path $d -Max 20
      if ($files.Count -gt 0) {
        $sections += (New-PreviewSection -Label "Files (sample) - $d" -Items $files)
      }
    }
  } else {
    $sections += (New-PreviewSection -Label 'Directories' -Items $dirs)
  }

  if (-not (Test-IsAdmin)) {
    $notes += 'Preview collected without administrator privileges. Some resources may not be visible.'
  }

  $obj = @{ success = $true; osHint = 'Windows'; sections = $sections; notes = $notes; error = $null }
  $obj | ConvertTo-Json -Depth 6
  exit 0
}

function Get-CurrentUserId {
  # Returns DOMAIN\User (or MACHINE\User) which Task Scheduler APIs expect.
  try {
    return [Security.Principal.WindowsIdentity]::GetCurrent().Name
  } catch {
    if (-not [string]::IsNullOrWhiteSpace($env:USERDOMAIN) -and -not [string]::IsNullOrWhiteSpace($env:USERNAME)) {
      return "$env:USERDOMAIN\$env:USERNAME"
    }
    return $env:USERNAME
  }
}

function Get-UserRunKeyPath {
  return 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
}

function Set-UserAutostart([string]$Name, [string]$CommandLine) {
  $runKey = Get-UserRunKeyPath
  if (-not (Test-Path $runKey)) {
    New-Item -Path $runKey -Force | Out-Null
  }

  # Create/overwrite the Run value.
  New-ItemProperty -Path $runKey -Name $Name -Value $CommandLine -PropertyType String -Force | Out-Null
}

function Remove-UserAutostart([string]$Name) {
  $runKey = Get-UserRunKeyPath
  if (-not (Test-Path $runKey)) { return }

  try {
    Remove-ItemProperty -Path $runKey -Name $Name -ErrorAction Stop
  } catch {
    # ignore if missing
  }
}

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

function Test-IsAdmin {
  try {
    $currentIdentity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($currentIdentity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
  } catch {
    return $false
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

function Format-FileSize([long]$bytes) {
  if ($bytes -ge 1MB) { return "{0:N2} MB" -f ($bytes / 1MB) }
  elseif ($bytes -ge 1KB) { return "{0:N2} KB" -f ($bytes / 1KB) }
  else { return "$bytes B" }
}

function Download-File([string]$Url, [string]$OutFile) {
  $dir = Split-Path -Parent $OutFile
  if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }

  # Use WebClient for progress tracking
  $webClient = New-Object System.Net.WebClient
  $fileName = Split-Path -Leaf $OutFile
  
  # Variables to track progress
  $lastPercent = -1
  $startTime = Get-Date
  $lastReportTime = $startTime
  
  # Register progress event handler
  $progressHandler = {
    param($sender, $e)
    
    $now = Get-Date
    $elapsed = ($now - $startTime).TotalSeconds
    
    # Only report progress every 500ms or when percentage changes significantly
    if (($now - $lastReportTime).TotalMilliseconds -ge 500 -or $e.ProgressPercentage -ne $lastPercent) {
      $lastReportTime = $now
      $lastPercent = $e.ProgressPercentage
      
      $bytesReceived = $e.BytesReceived
      $totalBytes = $e.TotalBytesToReceive
      $percent = $e.ProgressPercentage
      
      # Calculate speed
      $speed = if ($elapsed -gt 0) { $bytesReceived / $elapsed } else { 0 }
      $speedStr = (Format-FileSize $speed) + "/s"
      
      # Format progress message
      $receivedStr = Format-FileSize $bytesReceived
      $totalStr = if ($totalBytes -gt 0) { Format-FileSize $totalBytes } else { "?" }
      
      # Build progress bar
      $barWidth = 30
      $filled = [math]::Floor($barWidth * $percent / 100)
      $empty = $barWidth - $filled
      $bar = ('#' * $filled) + ('-' * $empty)
      
      $msg = "  [$bar] ${percent}% ($receivedStr / $totalStr) @ $speedStr"
      Write-Host "`r$msg" -NoNewline
    }
  }
  
  # Register the event
  Register-ObjectEvent -InputObject $webClient -EventName DownloadProgressChanged -Action $progressHandler | Out-Null
  
  try {
    Write-Host "  Starting download: $fileName"
    $webClient.DownloadFile($Url, $OutFile)
    Write-Host ""  # New line after progress bar
    Write-Host "  Download complete: $fileName"
  }
  finally {
    # Cleanup event handlers
    Get-EventSubscriber | Where-Object { $_.SourceObject -eq $webClient } | Unregister-Event
    $webClient.Dispose()
  }
}

function Get-GitHubReleaseInfo([string]$ServerUrl) {
  # Query the server for GitHub release configuration
  $infoUrl = "$ServerUrl/api/binaries/agent/github-release-info"
  try {
    $response = Invoke-RestMethod -Uri $infoUrl -Method Get -TimeoutSec 10 -ErrorAction Stop
    return $response
  } catch {
    Write-Verbose "Failed to get GitHub release info: $($_.Exception.Message)"
    return $null
  }
}

function Get-EffectiveGitHubReleaseOverride {
  # Allow explicit script args or environment variables for GitHub download.
  # Env vars are convenient for non-interactive bootstrap.
  $baseUrl = $GitHubReleaseBaseUrl
  $version = $GitHubVersion
  $prefer = $PreferGitHub

  if ([string]::IsNullOrWhiteSpace($baseUrl) -and -not [string]::IsNullOrWhiteSpace($env:MANLAB_GITHUB_RELEASE_BASE_URL)) {
    $baseUrl = $env:MANLAB_GITHUB_RELEASE_BASE_URL
  }
  if ([string]::IsNullOrWhiteSpace($version) -and -not [string]::IsNullOrWhiteSpace($env:MANLAB_GITHUB_VERSION)) {
    $version = $env:MANLAB_GITHUB_VERSION
  }
  if (-not $prefer -and -not [string]::IsNullOrWhiteSpace($env:MANLAB_PREFER_GITHUB_DOWNLOAD)) {
    $prefer = ($env:MANLAB_PREFER_GITHUB_DOWNLOAD -eq '1' -or $env:MANLAB_PREFER_GITHUB_DOWNLOAD -eq 'true' -or $env:MANLAB_PREFER_GITHUB_DOWNLOAD -eq 'True')
  }

  return [ordered]@{
    Prefer = [bool]$prefer
    BaseUrl = $baseUrl
    Version = $version
  }
}

function Try-DownloadFromGitHub([string]$ServerUrl, [string]$Rid, [string]$OutFile) {
  # Attempt to download the agent binary from GitHub releases
  # GitHub releases contain archives (.zip for Windows), so we download and extract
  # Returns $true if successful, $false otherwise

  $override = Get-EffectiveGitHubReleaseOverride
  $archiveUrl = $null
  $binaryName = "manlab-agent.exe"

  if ($override.Prefer -and -not [string]::IsNullOrWhiteSpace([string]$override.BaseUrl) -and -not [string]::IsNullOrWhiteSpace([string]$override.Version)) {
    $archiveUrl = "{0}/{1}/manlab-agent-{2}.zip" -f ($override.BaseUrl.TrimEnd('/')), $override.Version, $Rid
  } else {
    $releaseInfo = Get-GitHubReleaseInfo -ServerUrl $ServerUrl
    if ($null -eq $releaseInfo -or -not $releaseInfo.enabled) {
      Write-Verbose "GitHub release downloads not enabled or not configured"
      return $false
    }

    $downloadUrls = $releaseInfo.downloadUrls
    if ($null -eq $downloadUrls -or -not $downloadUrls.PSObject.Properties.Name.Contains($Rid)) {
      Write-Verbose "No GitHub download URL found for RID: $Rid"
      return $false
    }

    $ridInfo = $downloadUrls.$Rid
    $archiveUrl = $ridInfo.archiveUrl
    if (-not [string]::IsNullOrWhiteSpace($ridInfo.binaryName)) {
      $binaryName = $ridInfo.binaryName
    }
  }

  if ([string]::IsNullOrWhiteSpace($archiveUrl)) {
    Write-Verbose "GitHub archive URL is empty for RID: $Rid"
    return $false
  }
  
  Write-Host "Attempting download from GitHub release: $archiveUrl"
  $tempDir = $null
  try {
    # Download archive to temp location
    $tempDir = Join-Path ([System.IO.Path]::GetTempPath()) "manlab-install-$([Guid]::NewGuid().ToString('N'))"
    New-Item -ItemType Directory -Path $tempDir -Force | Out-Null
    $archivePath = Join-Path $tempDir "agent-archive.zip"
    
    Download-File -Url $archiveUrl -OutFile $archivePath
    
    # Extract the archive
    Write-Host "  Extracting archive..."
    Expand-Archive -Path $archivePath -DestinationPath $tempDir -Force

    # Find and copy the binary (be tolerant of nested folders)
    $extractedBinary = $null
    try {
      $match = Get-ChildItem -Path $tempDir -Recurse -File -ErrorAction Stop | Where-Object { $_.Name -ieq $binaryName } | Select-Object -First 1
      if ($null -ne $match) {
        $extractedBinary = $match.FullName
      }
    } catch {
      $extractedBinary = $null
    }

    if ([string]::IsNullOrWhiteSpace($extractedBinary) -or -not (Test-Path $extractedBinary)) {
      throw "Binary '$binaryName' not found in extracted archive"
    }
    
    # Ensure output directory exists
    $outDir = Split-Path -Parent $OutFile
    if (-not (Test-Path $outDir)) {
      New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    }
    
    Copy-Item -Path $extractedBinary -Destination $OutFile -Force
    Write-Host "  Downloaded and extracted from GitHub successfully"
    return $true
  } catch {
    Write-Warning "GitHub download failed: $($_.Exception.Message)"
    Write-Host "  Falling back to server download..."
    return $false
  } finally {
    # Cleanup temp directory
    if ($null -ne $tempDir -and (Test-Path $tempDir)) {
      try { Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue } catch { }
    }
  }
}

function Update-AgentAppSettings(
  [string]$Path,
  [string]$ServerUrl,
  [string]$AuthToken,
  [int]$HeartbeatIntervalSeconds,
  [int]$MaxReconnectDelaySeconds,
  [string]$EnableLogViewer,
  [string]$EnableScripts,
  [string]$EnableTerminal,
  [string]$EnableFileBrowser
) {
  $obj = $null

  if (Test-Path $Path) {
    try {
      $raw = Get-Content -Path $Path -Raw -ErrorAction Stop
      if (-not [string]::IsNullOrWhiteSpace($raw)) {
        $obj = $raw | ConvertFrom-Json -ErrorAction Stop
      }
    } catch {
      # If the existing file is malformed, do not fail the install.
      Write-Warning "Existing appsettings.json is invalid JSON. Recreating it: $Path"
      $obj = $null
    }
  }

  if ($null -eq $obj) {
    $obj = [ordered]@{}
  }

  if ($null -eq $obj.Agent) {
    $obj | Add-Member -NotePropertyName 'Agent' -NotePropertyValue ([ordered]@{}) -Force
  }

  # Always set ServerUrl/intervals; set token only when provided.
  $obj.Agent.ServerUrl = $ServerUrl
  $obj.Agent.HeartbeatIntervalSeconds = $HeartbeatIntervalSeconds
  $obj.Agent.MaxReconnectDelaySeconds = $MaxReconnectDelaySeconds

  if (-not [string]::IsNullOrWhiteSpace($AuthToken)) {
    $obj.Agent.AuthToken = $AuthToken
  }

  # Remote tools: default-deny. Only set when explicitly provided (tri-state).
  function Try-ApplyBool([string]$name, [string]$value) {
    if ([string]::IsNullOrWhiteSpace($value)) { return }
    $b = $null
    if ([bool]::TryParse($value.Trim(), [ref]$b)) {
      $obj.Agent.$name = $b
    }
  }

  # Prefer explicit installer parameters; fall back to env vars for non-interactive flows.
  if ([string]::IsNullOrWhiteSpace($EnableLogViewer) -and -not [string]::IsNullOrWhiteSpace($env:MANLAB_ENABLE_LOG_VIEWER)) { $EnableLogViewer = $env:MANLAB_ENABLE_LOG_VIEWER }
  if ([string]::IsNullOrWhiteSpace($EnableScripts) -and -not [string]::IsNullOrWhiteSpace($env:MANLAB_ENABLE_SCRIPTS)) { $EnableScripts = $env:MANLAB_ENABLE_SCRIPTS }
  if ([string]::IsNullOrWhiteSpace($EnableTerminal) -and -not [string]::IsNullOrWhiteSpace($env:MANLAB_ENABLE_TERMINAL)) { $EnableTerminal = $env:MANLAB_ENABLE_TERMINAL }
  if ([string]::IsNullOrWhiteSpace($EnableFileBrowser) -and -not [string]::IsNullOrWhiteSpace($env:MANLAB_ENABLE_FILE_BROWSER)) { $EnableFileBrowser = $env:MANLAB_ENABLE_FILE_BROWSER }

  Try-ApplyBool 'EnableLogViewer' $EnableLogViewer
  Try-ApplyBool 'EnableScripts' $EnableScripts
  Try-ApplyBool 'EnableTerminal' $EnableTerminal
  Try-ApplyBool 'EnableFileBrowser' $EnableFileBrowser

  $json = $obj | ConvertTo-Json -Depth 20
  $json | Set-Content -Path $Path -Encoding UTF8
}

function Try-CreateUserScheduledTask([
  string]$Name,
  [string]$RunnerPath,
  [ref]$ErrorDetails
) {
  $ErrorDetails.Value = $null

  # Prefer the ScheduledTasks module (Task Scheduler API) because schtasks.exe
  # behavior varies by policy/locale and can emit scary "ERROR:" output.
  try {
    $null = Get-Command -Name Register-ScheduledTask -ErrorAction Stop
  } catch {
    $ErrorDetails.Value = "ScheduledTasks module not available: $($_.Exception.Message)"
    return $false
  }

  $userId = Get-CurrentUserId
  $psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunnerPath`""

  try {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType InteractiveToken -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

    Register-ScheduledTask -TaskName $Name -InputObject $task -Force | Out-Null
    return $true
  } catch {
    $ErrorDetails.Value = $_.Exception.Message
    return $false
  }
}

function Get-ScheduledTaskIfExists([string]$Name) {
  try {
    $null = Get-Command -Name Get-ScheduledTask -ErrorAction Stop
    return (Get-ScheduledTask -TaskName $Name -ErrorAction Stop)
  } catch {
    return $null
  }
}

function Remove-ScheduledTaskIfExists([string]$Name) {
  try {
    $null = Get-Command -Name Unregister-ScheduledTask -ErrorAction Stop
  } catch {
    # Fallback to schtasks.exe
    try {
      & schtasks /Delete /TN "$Name" /F 2>$null | Out-Null
    } catch { }
    return
  }

  $task = Get-ScheduledTaskIfExists -Name $Name
  if ($null -eq $task) { return }

  try {
    # Stop if running (best effort)
    $null = Get-Command -Name Stop-ScheduledTask -ErrorAction Stop
    try { Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue | Out-Null } catch { }
  } catch {
    # ignore
  }

  try {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction Stop | Out-Null
  } catch {
    # ignore
  }
}

function Start-ScheduledTaskIfExists([string]$Name) {
  try {
    $null = Get-Command -Name Start-ScheduledTask -ErrorAction Stop
    Start-ScheduledTask -TaskName $Name -ErrorAction Stop | Out-Null
    return $true
  } catch {
    # Fallback
    try {
      & schtasks /Run /TN "$Name" 2>$null | Out-Null
      return ($LASTEXITCODE -eq 0)
    } catch {
      return $false
    }
  }
}

function Create-OrUpdateSystemScheduledTask([
  string]$Name,
  [string]$RunnerPath,
  [ref]$ErrorDetails
) {
  $ErrorDetails.Value = $null

  # Prefer ScheduledTasks module (Task Scheduler API)
  try {
    $null = Get-Command -Name Register-ScheduledTask -ErrorAction Stop
  } catch {
    $ErrorDetails.Value = "ScheduledTasks module not available: $($_.Exception.Message)"
    return $false
  }

  $psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$RunnerPath`""

  try {
    $action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs
    $trigger = New-ScheduledTaskTrigger -AtStartup
    # Run as LocalSystem with highest privileges
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
    $settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
    $task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings

    Register-ScheduledTask -TaskName $Name -InputObject $task -Force | Out-Null
    return $true
  } catch {
    $ErrorDetails.Value = $_.Exception.Message
    return $false
  }
}

# Override InstallDir if UserMode and no explicit path provided
if ($UserMode -and $InstallDir -eq "C:\ProgramData\ManLab\Agent") {
  $InstallDir = "$env:LOCALAPPDATA\ManLab\Agent"
}

# Use different task names for system vs user mode to avoid conflicts
if ($UserMode -and $TaskName -eq "ManLab Agent") {
  $TaskName = "ManLab Agent User"
}

# Only require admin if not in user mode
if (-not $UserMode -and -not ($Uninstall -and $UninstallAll)) {
  Assert-Admin
}

if ($Uninstall) {
  function Invoke-UninstallSingle(
    [string]$ThisTaskName,
    [string]$ThisInstallDir,
    [bool]$ThisUserMode
  ) {
    Write-Host "Uninstall target:"
    Write-Host "  Task name:   $ThisTaskName"
    Write-Host "  Install dir: $ThisInstallDir"

    # Remove scheduled task if present (best-effort)
    $task = Get-ScheduledTaskIfExists -Name $ThisTaskName
    if ($null -ne $task) {
      Write-Host "Removing scheduled task: $ThisTaskName"
      Remove-ScheduledTaskIfExists -Name $ThisTaskName
    } else {
      # In case the ScheduledTasks module isn't available, attempt schtasks-based removal anyway.
      try {
        & schtasks /Query /TN "$ThisTaskName" 2>$null | Out-Null
        if ($LASTEXITCODE -eq 0) {
          Write-Host "Removing scheduled task (fallback): $ThisTaskName"
          try { & schtasks /End /TN "$ThisTaskName" 2>$null | Out-Null } catch { }
          try { & schtasks /Delete /TN "$ThisTaskName" /F 2>$null | Out-Null } catch { }
        } else {
          Write-Host "Scheduled task not found; skipping."
        }
      } catch {
        Write-Host "Scheduled task not found; skipping."
      }
    }

    if ($ThisUserMode) {
      # In user mode we may have used HKCU Run as a fallback for autostart.
      Write-Host "Removing user autostart entry (best-effort): $ThisTaskName"
      Remove-UserAutostart -Name $ThisTaskName
    }

    # Remove install directory
    if (-not [string]::IsNullOrWhiteSpace($ThisInstallDir) -and (Test-Path $ThisInstallDir)) {
      # Basic safety guard
      if ($ThisInstallDir.TrimEnd('\\') -eq 'C:' -or $ThisInstallDir.TrimEnd('\\') -eq 'C:\\') {
        throw "Refusing to delete unsafe InstallDir: $ThisInstallDir"
      }

      Write-Host "Deleting install directory: $ThisInstallDir"
      Remove-Item -Path $ThisInstallDir -Recurse -Force
    } else {
      Write-Host "Install directory not found; skipping."
    }
  }

  if ($UninstallAll) {
    Write-Host "Uninstalling ManLab Agent (all modes)"

    # Best-effort: remove legacy Windows Service installs (older versions might have used a service).
    try {
      $svc = Get-Service -Name 'manlab-agent' -ErrorAction Stop
      if ($null -ne $svc) {
        Write-Host "Stopping legacy Windows service (best-effort): manlab-agent"
        try { Stop-Service -Name 'manlab-agent' -Force -ErrorAction SilentlyContinue } catch { }
        try { & sc.exe delete "manlab-agent" | Out-Null } catch { }
      }
    } catch {
      # ignore if missing
    }

    # Best-effort: remove any scheduled tasks that clearly reference the agent.
    # We do this in addition to removing the known default task names.
    try {
      $null = Get-Command -Name Get-ScheduledTask -ErrorAction Stop
      $tasks = Get-ScheduledTask -ErrorAction SilentlyContinue
      foreach ($t in ($tasks | Where-Object { $_.TaskName -like '*ManLab*Agent*' })) {
        $actionsText = ($t.Actions | ForEach-Object { ($_.Execute + ' ' + $_.Arguments) }) -join ' '
        if ($actionsText -match 'manlab-agent\.exe' -or $actionsText -match 'run-agent\.ps1' -or $t.TaskName -match '^ManLab Agent') {
          Write-Host "Removing detected scheduled task (best-effort): $($t.TaskName)"
          try { Unregister-ScheduledTask -TaskName $t.TaskName -Confirm:$false -ErrorAction SilentlyContinue } catch { }
        }
      }
    } catch {
      # ignore; we'll still remove known tasks by name via schtasks fallback below.
    }

    $systemTask = 'ManLab Agent'
    $systemDir = 'C:\ProgramData\ManLab\Agent'
    $userTask = 'ManLab Agent User'
    $userDir = if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) { "$env:LOCALAPPDATA\ManLab\Agent" } else { $null }

    if (Test-IsAdmin) {
      Invoke-UninstallSingle -ThisTaskName $systemTask -ThisInstallDir $systemDir -ThisUserMode:$false
    } else {
      Write-Host "Skipping system uninstall (requires admin): $systemTask @ $systemDir"
    }

    if (-not [string]::IsNullOrWhiteSpace($userDir)) {
      Invoke-UninstallSingle -ThisTaskName $userTask -ThisInstallDir $userDir -ThisUserMode:$true
    } else {
      Write-Host "Skipping user-mode directory cleanup (LOCALAPPDATA unavailable)."
      # Still attempt scheduled task removal in case a task was registered.
      Invoke-UninstallSingle -ThisTaskName $userTask -ThisInstallDir "" -ThisUserMode:$true
    }

    # Extra safety cleanup: remove common leftover directories from older installers.
    # We keep this list conservative.
    $legacyDirs = @(
      'C:\ProgramData\ManLab\Agent',
      'C:\ProgramData\ManLab\agent',
      'C:\ProgramData\ManLab.Agent',
      'C:\ProgramData\ManLab'
    )

    foreach ($d in $legacyDirs) {
      try {
        if (Test-Path $d) {
          # Avoid deleting the entire ManLab folder if it contains other things.
          if ($d -eq 'C:\ProgramData\ManLab') {
            $agentChild = Join-Path $d 'Agent'
            if (Test-Path $agentChild) {
              Write-Host "Deleting leftover agent directory: $agentChild"
              Remove-Item -Path $agentChild -Recurse -Force -ErrorAction SilentlyContinue
            }
            continue
          }

          if ($d.TrimEnd('\\') -eq 'C:' -or $d.TrimEnd('\\') -eq 'C:\\') {
            continue
          }

          Write-Host "Deleting leftover directory (best-effort): $d"
          Remove-Item -Path $d -Recurse -Force -ErrorAction SilentlyContinue
        }
      } catch {
        # ignore
      }
    }

    # Also uninstall explicit custom path/name if provided and different from defaults.
    if (-not [string]::IsNullOrWhiteSpace($TaskName) -and ($TaskName -ne $systemTask) -and ($TaskName -ne $userTask)) {
      Invoke-UninstallSingle -ThisTaskName $TaskName -ThisInstallDir $InstallDir -ThisUserMode:([bool]$UserMode)
    } elseif (-not [string]::IsNullOrWhiteSpace($InstallDir) -and ($InstallDir -ne $systemDir) -and ($null -eq $userDir -or $InstallDir -ne $userDir)) {
      Invoke-UninstallSingle -ThisTaskName $TaskName -ThisInstallDir $InstallDir -ThisUserMode:([bool]$UserMode)
    }

    Write-Host "Uninstall complete."
    exit 0
  }

  Write-Host "Uninstalling ManLab Agent"
  Write-Host "  Task name:   $TaskName"
  Write-Host "  Install dir: $InstallDir"

  # Remove scheduled task if present (best-effort)
  $task = Get-ScheduledTaskIfExists -Name $TaskName
  if ($null -ne $task) {
    Write-Host "Removing scheduled task: $TaskName"
    Remove-ScheduledTaskIfExists -Name $TaskName
  } else {
    # In case the ScheduledTasks module isn't available, attempt schtasks-based removal anyway.
    try {
      & schtasks /Query /TN "$TaskName" 2>$null | Out-Null
      if ($LASTEXITCODE -eq 0) {
        Write-Host "Removing scheduled task (fallback): $TaskName"
        try { & schtasks /End /TN "$TaskName" 2>$null | Out-Null } catch { }
        try { & schtasks /Delete /TN "$TaskName" /F 2>$null | Out-Null } catch { }
      } else {
        Write-Host "Scheduled task not found; skipping."
      }
    } catch {
      Write-Host "Scheduled task not found; skipping."
    }
  }

  if ($UserMode) {
    # In user mode we may have used HKCU Run as a fallback for autostart.
    Write-Host "Removing user autostart entry (best-effort): $TaskName"
    Remove-UserAutostart -Name $TaskName
  }

  # Remove install directory
  if (-not [string]::IsNullOrWhiteSpace($InstallDir) -and (Test-Path $InstallDir)) {
    # Basic safety guard
    if ($InstallDir.TrimEnd('\\') -eq 'C:' -or $InstallDir.TrimEnd('\\') -eq 'C:\\') {
      throw "Refusing to delete unsafe InstallDir: $InstallDir"
    }

    Write-Host "Deleting install directory: $InstallDir"
    Remove-Item -Path $InstallDir -Recurse -Force
  } else {
    Write-Host "Install directory not found; skipping."
  }

  Write-Host "Uninstall complete."
  exit 0
}

try {

# Support non-interactive configuration via environment variables as well.
# This is useful for SSH bootstrap flows.
if ([string]::IsNullOrWhiteSpace($Server)) {
  $Server = if (-not [string]::IsNullOrWhiteSpace($env:MANLAB_SERVER_BASE_URL)) { $env:MANLAB_SERVER_BASE_URL } else { $env:MANLAB_SERVER }
}

if ([string]::IsNullOrWhiteSpace($AuthToken)) {
  $AuthToken = if (-not [string]::IsNullOrWhiteSpace($env:MANLAB_ENROLLMENT_TOKEN)) { $env:MANLAB_ENROLLMENT_TOKEN } else { $env:MANLAB_AUTH_TOKEN }
}

if ([string]::IsNullOrWhiteSpace($Server)) {
  throw "Server is required. Provide -Server or set MANLAB_SERVER_BASE_URL / MANLAB_SERVER."
}

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

# Try downloading from GitHub releases first, fall back to server API
$downloadedFromGitHub = Try-DownloadFromGitHub -ServerUrl $Server -Rid $Rid -OutFile $exePath

if (-not $downloadedFromGitHub) {
  Write-Host "Downloading agent binary from server: $binUrl"
  Download-File -Url $binUrl -OutFile $exePath
}

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

# Persist settings into installed appsettings.json so the agent can authorize on restart
# even if it's launched without the runner/env vars.
try {
  Update-AgentAppSettings -Path $appSettingsPath -ServerUrl $hubUrl -AuthToken $AuthToken -HeartbeatIntervalSeconds $HeartbeatIntervalSeconds -MaxReconnectDelaySeconds $MaxReconnectDelaySeconds -EnableLogViewer $EnableLogViewer -EnableScripts $EnableScripts -EnableTerminal $EnableTerminal -EnableFileBrowser $EnableFileBrowser
  if (-not [string]::IsNullOrWhiteSpace($AuthToken)) {
    Write-Host "Saved auth token to appsettings.json."
  }
} catch {
  Write-Warning "Failed to update installed appsettings.json (continuing): $($_.Exception.Message)"
}

# Write config used by the runner
$config = [ordered]@{
  ServerUrl = $hubUrl
  AuthToken = $AuthToken
  LogPath = $logPath
  HeartbeatIntervalSeconds = $HeartbeatIntervalSeconds
  MaxReconnectDelaySeconds = $MaxReconnectDelaySeconds

  # Remote tool toggles (optional)
  EnableLogViewer = $EnableLogViewer
  EnableScripts = $EnableScripts
  EnableTerminal = $EnableTerminal
  EnableFileBrowser = $EnableFileBrowser
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

if ($null -ne $config.HeartbeatIntervalSeconds) {
  $env:MANLAB_HEARTBEAT_INTERVAL_SECONDS = [string]$config.HeartbeatIntervalSeconds
}

if ($null -ne $config.MaxReconnectDelaySeconds) {
  $env:MANLAB_MAX_RECONNECT_DELAY_SECONDS = [string]$config.MaxReconnectDelaySeconds
}

# Remote tools (default-deny): only set when present in config.
if ($null -ne $config.EnableLogViewer -and -not [string]::IsNullOrWhiteSpace([string]$config.EnableLogViewer)) {
  $env:MANLAB_ENABLE_LOG_VIEWER = [string]$config.EnableLogViewer
}
if ($null -ne $config.EnableScripts -and -not [string]::IsNullOrWhiteSpace([string]$config.EnableScripts)) {
  $env:MANLAB_ENABLE_SCRIPTS = [string]$config.EnableScripts
}
if ($null -ne $config.EnableTerminal -and -not [string]::IsNullOrWhiteSpace([string]$config.EnableTerminal)) {
  $env:MANLAB_ENABLE_TERMINAL = [string]$config.EnableTerminal
}
if ($null -ne $config.EnableFileBrowser -and -not [string]::IsNullOrWhiteSpace([string]$config.EnableFileBrowser)) {
  $env:MANLAB_ENABLE_FILE_BROWSER = [string]$config.EnableFileBrowser
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

try {
  # Run in foreground so the scheduled task stays alive.
  # NOTE: When this runner is launched with -WindowStyle Hidden, PowerShell's
  # native redirection operators (1>> / 2>>) can fail to capture output because
  # there may be no attached console.
  # Use cmd.exe for redirection so output is reliably appended to the log.
  $cmd = "`"$exe`" >> `"$logPath`" 2>>&1"
  & cmd.exe /d /c $cmd | Out-Null
} catch {
  "[$(Get-Date -Format o)] Runner failed: $($_.Exception.Message)" | Add-Content -Path $logPath -Encoding UTF8
  throw
}
'@

$runner | Set-Content -Path $runnerPath -Encoding UTF8

# Register scheduled task
# Use Task Scheduler where possible; fall back to HKCU Run in user mode if blocked by policy.
# Check if task exists.
$taskExists = $false
$existing = Get-ScheduledTaskIfExists -Name $TaskName
if ($null -ne $existing) {
  $taskExists = $true
} else {
  # Fallback for environments lacking ScheduledTasks module
  try {
    & schtasks /Query /TN "$TaskName" 2>$null | Out-Null
    if ($LASTEXITCODE -eq 0) {
      $taskExists = $true
    }
  } catch {
    $taskExists = $false
  }
}

if ($taskExists) {
  if (-not $Force) {
    throw "Scheduled task '$TaskName' already exists. Re-run with -Force to recreate."
  }
  # Do NOT delete first: if creation fails (e.g., policy/ACL), we'd leave the machine with no task.
  # Both schtasks.exe (/F) and Register-ScheduledTask (-Force) can overwrite in-place.
}

$taskCommand = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`""

Write-Host "Creating scheduled task: $TaskName"
$createdScheduledTask = $false
if ($UserMode) {
  # User mode: Task Scheduler creation is sometimes blocked by local policy for standard users.
  # Try the ScheduledTasks API first (less noisy, more reliable), then schtasks.exe.
  $details = $null
  if (Try-CreateUserScheduledTask -Name $TaskName -RunnerPath $runnerPath -ErrorDetails ([ref]$details)) {
    $createdScheduledTask = $true
  } else {
    $createExitCode = 1
    $createOutput = $null
    try {
      # Capture output for verbose diagnostics, but avoid echoing schtasks.exe "ERROR:" lines
      # to normal logs (that tends to look like an installer failure even when we can fall back).
      $createOutput = & schtasks /Create /TN "$TaskName" /TR "$taskCommand" /SC ONLOGON /RL LIMITED /F 2>&1
      $createExitCode = $LASTEXITCODE
    } catch {
      $createOutput = $_
      $createExitCode = 1
    }

    if ($createExitCode -eq 0) {
      $createdScheduledTask = $true
    } else {
      $msg = "Scheduled task creation is blocked for this user (policy/ACL). Using per-user autostart instead."
      Write-Warning $msg
      if ($PSBoundParameters.ContainsKey('Verbose')) {
        Write-Verbose "ScheduledTasks API error: $details"
        Write-Verbose "schtasks.exe exit code: $createExitCode"
        Write-Verbose "schtasks.exe output: $createOutput"
      }

      # Use a per-user Run entry (no admin required) as a robust fallback.
      Set-UserAutostart -Name $TaskName -CommandLine $taskCommand
    }
  }
} else {
  # Admin mode: run as SYSTEM at startup (requires admin).
  # Prefer ScheduledTasks cmdlets (Task Scheduler API) over schtasks.exe.
  $details = $null
  if (Create-OrUpdateSystemScheduledTask -Name $TaskName -RunnerPath $runnerPath -ErrorDetails ([ref]$details)) {
    $createdScheduledTask = $true
  } else {
    Write-Warning "Failed to register scheduled task via ScheduledTasks API: $details"
    # Fallback to schtasks.exe for rare environments where ScheduledTasks is unavailable.
    schtasks /Create /TN "$TaskName" /TR "$taskCommand" /SC ONSTART /RU "SYSTEM" /RL HIGHEST /F | Out-Null
    $createdScheduledTask = $true
  }
}

if ($createdScheduledTask) {
  Write-Host "Starting scheduled task: $TaskName"
  $null = Start-ScheduledTaskIfExists -Name $TaskName
} else {
  Write-Host "Starting agent process (user mode fallback)"
  Start-Process -FilePath "powershell.exe" -ArgumentList @(
    "-NoProfile",
    "-ExecutionPolicy", "Bypass",
    "-WindowStyle", "Hidden",
    "-File", $runnerPath
  ) -WorkingDirectory $InstallDir | Out-Null
}

Write-Host "Installed. Logs will be written to: $logPath"
if ($UserMode) {
  Write-Host "To remove: .\\scripts\\install.ps1 -Uninstall -UserMode -TaskName `"$TaskName`" -InstallDir `"$InstallDir`""
} else {
  Write-Host "To remove: .\\scripts\\install.ps1 -Uninstall -TaskName `"$TaskName`" -InstallDir `"$InstallDir`""
}

} catch {
  # IMPORTANT: Do not roll back partially completed installs. Leave any downloaded
  # files/config in place for inspection or manual recovery.
  $details = $null
  try {
    $details = $_.Exception.Message
  } catch {
    $details = $null
  }

  if ([string]::IsNullOrWhiteSpace($details)) {
    # Fall back to the full error record string (includes inner exception details).
    $details = (($_ | Out-String).Trim())
  }

  Write-Error "Installation failed: $details"
  if ($PSBoundParameters.ContainsKey('Verbose')) {
    Write-Verbose $_.Exception.ToString()
  }
  exit 1
}
