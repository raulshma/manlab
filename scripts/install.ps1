<#
.SYNOPSIS
    ManLab Agent Installer - Bootstrap Wrapper
.DESCRIPTION
    This wrapper delegates to the modular installer when available,
    or provides a minimal self-contained installation for remote execution.
.EXAMPLE
    iwr http://manlab:5247/install.ps1 -UseBasicParsing | iex; Install-ManLabAgent -Server http://manlab:5247
#>

[CmdletBinding()]
param(
    [string]$Server,
    [string]$AuthToken,
    [string]$InstallDir = "C:\ProgramData\ManLab\Agent",
    [string]$TaskName = "ManLab Agent",
    [switch]$Force,
    [switch]$Uninstall,
    [switch]$UninstallAll,
    [switch]$UserMode,
    [switch]$PreviewUninstall,
    [string]$EnableLogViewer,
    [string]$EnableScripts,
    [string]$EnableTerminal,
    [string]$EnableFileBrowser,

    # Agent download source selection
    [string]$AgentChannel,
    [string]$AgentVersion,

    # GitHub
    [switch]$PreferGitHub,
    [string]$GitHubReleaseBaseUrl,
    [string]$GitHubVersion
)

$ErrorActionPreference = 'Stop'

# Check if modular installer exists locally
$ScriptDir = $PSScriptRoot
$LocalInstaller = Join-Path $ScriptDir "installer\Install-Agent.ps1"

if (Test-Path $LocalInstaller) {
    # Delegate to modular installer
    & $LocalInstaller @PSBoundParameters
    exit $LASTEXITCODE
}

#=============================================================================
# EMBEDDED MINIMAL INSTALLER (for remote execution)
#=============================================================================

function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Err { param([string]$Message) Write-Host "[ERROR] $Message" -ForegroundColor Red }

function Test-Admin {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = [Security.Principal.WindowsPrincipal]::new($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Get-Rid {
    $arch = $env:PROCESSOR_ARCHITECTURE
    $arch2 = $env:PROCESSOR_ARCHITEW6432
    $effective = if ($arch2) { $arch2 } else { $arch }
    switch -Regex ($effective) {
        'ARM64' { return 'win-arm64' }
        'AMD64|x86_64' { return 'win-x64' }
        default { throw "Unsupported: $effective" }
    }
}

function New-UrlWithQuery {
    param(
        [Parameter(Mandatory = $true)][string]$BaseUrl,
        [hashtable]$Query
    )

    if (-not $Query -or $Query.Count -eq 0) { return $BaseUrl }

    $pairs = @()
    foreach ($k in $Query.Keys) {
        $v = $Query[$k]
        if ([string]::IsNullOrWhiteSpace([string]$v)) { continue }
        $pairs += ("{0}={1}" -f [Uri]::EscapeDataString([string]$k), [Uri]::EscapeDataString([string]$v))
    }
    if ($pairs.Count -eq 0) { return $BaseUrl }
    return "$BaseUrl?" + ($pairs -join "&")
}

function Show-LocalAgentVersions {
    param(
        [Parameter(Mandatory = $true)][string]$BaseServerUrl,
        [string]$Channel
    )

    try {
        $catalogUrl = New-UrlWithQuery -BaseUrl "$BaseServerUrl/api/binaries/agent/release-catalog" -Query @{ channel = $Channel }
        $raw = (Invoke-WebRequest -UseBasicParsing -Uri $catalogUrl).Content
        if ([string]::IsNullOrWhiteSpace($raw)) {
            Write-Warn "Unable to query local agent versions (empty response)."
            return
        }

        $catalog = $raw | ConvertFrom-Json
        $local = $catalog.local
        $channelLabel = if ($catalog.channel) { [string]$catalog.channel } else { "" }

        if (-not $local -or $local.Count -eq 0) {
            Write-Info "No local agent versions staged for channel '$channelLabel'."
            return
        }

        Write-Info "Local agent versions available (channel: $channelLabel):"
        foreach ($item in $local) {
            $rids = if ($item.rids) { ($item.rids -join ', ') } else { "" }
            $stamp = if ($item.binaryLastWriteTimeUtc) { try { [DateTime]::Parse([string]$item.binaryLastWriteTimeUtc).ToString('u') } catch { [string]$item.binaryLastWriteTimeUtc } } else { "unknown" }
            Write-Info "  - $($item.version) [$rids] (last updated: $stamp)"
        }
    } catch {
        Write-Warn "Unable to query local agent versions: $_"
    }
}

function Try-DownloadAgentFromGitHub {
    param(
        [Parameter(Mandatory = $true)][string]$Rid,
        [Parameter(Mandatory = $true)][string]$OutFile
    )

    if (-not $PreferGitHub) { return $false }

    $baseUrl = $GitHubReleaseBaseUrl
    $version = $GitHubVersion

    # If not explicitly provided, try to fetch from the server helper endpoint.
    if ([string]::IsNullOrWhiteSpace($baseUrl) -or [string]::IsNullOrWhiteSpace($version)) {
        try {
            $infoUrl = "$Server/api/binaries/agent/github-release-info"
            $raw = (Invoke-WebRequest -UseBasicParsing -Uri $infoUrl).Content
            $info = $raw | ConvertFrom-Json
            if ($info.Enabled -and $info.ReleaseBaseUrl -and $info.LatestVersion) {
                $baseUrl = [string]$info.ReleaseBaseUrl
                $version = [string]$info.LatestVersion
            }
        } catch {
            # Ignore and fall back.
        }
    }

    if ([string]::IsNullOrWhiteSpace($baseUrl) -or [string]::IsNullOrWhiteSpace($version)) {
        return $false
    }

    try {
        $baseUrl = $baseUrl.TrimEnd('/')
        $archiveUrl = "$baseUrl/$version/manlab-agent-$Rid.zip"
        Write-Info "Attempting GitHub Releases download: $archiveUrl"

        $tmpDir = Join-Path $env:TEMP ([Guid]::NewGuid().ToString('N'))
        New-Item -ItemType Directory -Path $tmpDir -Force | Out-Null

        $zipPath = Join-Path $tmpDir "agent.zip"
        (New-Object Net.WebClient).DownloadFile($archiveUrl, $zipPath)

        $extractDir = Join-Path $tmpDir "extract"
        Expand-Archive -Path $zipPath -DestinationPath $extractDir -Force

        $candidate = Get-ChildItem -Path $extractDir -Recurse -File -Filter "manlab-agent.exe" | Select-Object -First 1
        if (-not $candidate) {
            Write-Warn "GitHub archive did not contain manlab-agent.exe; falling back to server"
            return $false
        }

        Copy-Item -Path $candidate.FullName -Destination $OutFile -Force
        return $true
    } catch {
        Write-Warn "GitHub download failed; falling back to server. $_"
        return $false
    } finally {
        if ($tmpDir -and (Test-Path $tmpDir)) {
            Remove-Item $tmpDir -Recurse -Force -ErrorAction SilentlyContinue
        }
    }
}

# Preview uninstall
if ($PreviewUninstall) {
    $sections = @()

    # Scheduled tasks (service equivalent)
    $taskItems = @()
    try {
        $candidateNames = @("ManLab Agent", "ManLab Agent User")
        if (-not [string]::IsNullOrWhiteSpace($TaskName)) { $candidateNames += $TaskName }

        $tasks = Get-ScheduledTask -ErrorAction Stop | Where-Object {
            $candidateNames -contains $_.TaskName -or $_.TaskName -like '*ManLab*Agent*'
        }

        foreach ($t in $tasks) {
            $taskItems += "Task: $($t.TaskPath)$($t.TaskName)"
        }
    } catch { }

    $taskItems = @($taskItems | Select-Object -Unique)
    $sections += @{ label = "Scheduled Tasks"; items = @($taskItems) }

    # Directories
    $candidateDirs = @($InstallDir, "C:\ProgramData\ManLab\Agent")
    if ($env:LOCALAPPDATA) { $candidateDirs += "$env:LOCALAPPDATA\ManLab\Agent" }
    $existingDirs = @($candidateDirs | Where-Object { Test-Path $_ } | Select-Object -Unique)
    $sections += @{ label = "Directories"; items = @($existingDirs) }

    @{ success = $true; osHint = "Windows"; sections = $sections; notes = @(); error = $null } | ConvertTo-Json -Depth 6
    exit 0
}

# Adjust for UserMode
if ($UserMode) {
    if (-not $InstallDir -or $InstallDir -eq "C:\ProgramData\ManLab\Agent") {
        $InstallDir = "$env:LOCALAPPDATA\ManLab\Agent"
    }
    if ($TaskName -eq "ManLab Agent") { $TaskName = "ManLab Agent User" }
} else {
    if (-not (Test-Admin)) { throw "Requires admin. Run as Administrator." }
}

# Uninstall
if ($Uninstall) {
    Write-Info "Uninstalling ManLab Agent..."
    
    # Helper: Stop a scheduled task and wait
    function Stop-EmbeddedAgentTask {
        param([string]$Name)
        try {
            $task = Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
            if ($task -and $task.State -eq 'Running') {
                Write-Info "Stopping scheduled task '$Name'..."
                Stop-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue
                Start-Sleep -Milliseconds 500
            }
        } catch { }
        try { 
            Unregister-ScheduledTask -TaskName $Name -Confirm:$false -ErrorAction Stop 
            Write-Info "Unregistered scheduled task '$Name'"
        } catch { }
    }
    
    # Helper: Kill agent processes and wait for file handles to release
    function Stop-EmbeddedAgentProcesses {
        Write-Info "Stopping any running agent processes..."
        Get-Process -Name "manlab-agent" -ErrorAction SilentlyContinue | ForEach-Object {
            Write-Info "  Terminating process $($_.Id)..."
            $_ | Stop-Process -Force -ErrorAction SilentlyContinue
        }
        # Wait for processes to terminate
        $maxWait = 10; $waited = 0
        while ($waited -lt $maxWait) {
            if (-not (Get-Process -Name "manlab-agent" -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Seconds 1; $waited++
        }
    }
    
    # Helper: Remove directory with retry for locked files
    function Remove-EmbeddedAgentDirectory {
        param([string]$Path)
        if (-not (Test-Path $Path)) { return }
        for ($i = 0; $i -lt 3; $i++) {
            try {
                Remove-Item $Path -Recurse -Force -ErrorAction Stop
                Write-Info "Removed directory: $Path"
                return
            } catch {
                if ($i -lt 2) {
                    Write-Warn "Retry $($i + 1)/3: Failed to remove '$Path', waiting 1s..."
                    Start-Sleep -Seconds 1
                } else {
                    Write-Err "Failed to remove '$Path' after 3 attempts: $_"
                    throw $_
                }
            }
        }
    }
    
    if ($UninstallAll) {
        Stop-EmbeddedAgentTask -Name "ManLab Agent"
        Stop-EmbeddedAgentTask -Name "ManLab Agent User"
        Stop-EmbeddedAgentProcesses
        Remove-EmbeddedAgentDirectory -Path "C:\ProgramData\ManLab\Agent"
        if ($env:LOCALAPPDATA) {
            Remove-EmbeddedAgentDirectory -Path "$env:LOCALAPPDATA\ManLab\Agent"
        }
    } else {
        Stop-EmbeddedAgentTask -Name $TaskName
        Stop-EmbeddedAgentProcesses
        Remove-EmbeddedAgentDirectory -Path $InstallDir
    }
    
    Write-Info "Uninstall complete"
    exit 0
}

# Validate
if ([string]::IsNullOrWhiteSpace($Server)) {
    $Server = if ($env:MANLAB_SERVER_BASE_URL) { $env:MANLAB_SERVER_BASE_URL } else { $env:MANLAB_SERVER }
}
if ([string]::IsNullOrWhiteSpace($AuthToken)) {
    $AuthToken = $env:MANLAB_AUTH_TOKEN
}
if ([string]::IsNullOrWhiteSpace($Server)) {
    throw "Server required. Use -Server"
}

$Server = $Server.TrimEnd('/')
$hubUrl = "$Server/hubs/agent"
$rid = Get-Rid

$exePath = Join-Path $InstallDir 'manlab-agent.exe'
$configPath = Join-Path $InstallDir 'appsettings.json'
$runnerPath = Join-Path $InstallDir 'run-agent.ps1'
$logPath = Join-Path $InstallDir 'agent.log'

# Update-mode safety: if no token was provided, try to preserve the existing one.
if ([string]::IsNullOrWhiteSpace($AuthToken) -and (Test-Path $runnerPath)) {
    try {
        $content = Get-Content $runnerPath -Raw -ErrorAction Stop
        $m = [Regex]::Match($content, "MANLAB_AUTH_TOKEN\s*=\s*'([^']*)'")
        if ($m.Success) {
            $existing = $m.Groups[1].Value
            if (-not [string]::IsNullOrWhiteSpace($existing)) {
                $AuthToken = $existing
            }
        }
    } catch {
        # Best-effort.
    }
}

if ([string]::IsNullOrWhiteSpace($AuthToken)) {
    throw "Auth token required. Use -AuthToken (or set MANLAB_AUTH_TOKEN)."
}

Write-Info "Installing ManLab Agent"
Write-Info "  Server: $Server"
Write-Info "  RID:    $rid"
Write-Info "  Dir:    $InstallDir"

Show-LocalAgentVersions -BaseServerUrl $Server -Channel $AgentChannel

if ((Test-Path $exePath) -and -not $Force) {
    throw "Already installed. Use -Force"
}

New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null

# Download binary
Write-Info "Downloading agent..."
if (-not (Try-DownloadAgentFromGitHub -Rid $rid -OutFile $exePath)) {
    $binUrl = New-UrlWithQuery -BaseUrl "$Server/api/binaries/agent/$rid" -Query @{ channel = $AgentChannel; version = $AgentVersion }
    (New-Object Net.WebClient).DownloadFile($binUrl, $exePath)
}

# Download server-generated appsettings.json template.
# This includes Agent Defaults configured via the Web UI.
Write-Info "Downloading agent configuration (appsettings.json)..."
try {
    $appsettingsUrl = New-UrlWithQuery -BaseUrl "$Server/api/binaries/agent/$rid/appsettings.json" -Query @{ channel = $AgentChannel; version = $AgentVersion }
    (New-Object Net.WebClient).DownloadFile($appsettingsUrl, $configPath)
} catch {
    Write-Warn "Failed to download appsettings.json template; using minimal config"
    $config = @{
        Agent = @{
            ServerUrl = $hubUrl
            AuthToken = ""
            HeartbeatIntervalSeconds = 15
            MaxReconnectDelaySeconds = 60
            TelemetryCacheSeconds = 30
            PrimaryInterfaceName = ""
            EnableNetworkTelemetry = $true
            EnablePingTelemetry = $true
            EnableGpuTelemetry = $true
            EnableUpsTelemetry = $true
            EnableEnhancedNetworkTelemetry = $true
            EnableEnhancedGpuTelemetry = $true
            EnableApmTelemetry = $false
            ApmHealthCheckEndpoints = @()
            ApmDatabaseEndpoints = @()
            EnableLogViewer = $EnableLogViewer -eq 'true'
            EnableScripts = $EnableScripts -eq 'true'
            EnableTerminal = $EnableTerminal -eq 'true'
            EnableFileBrowser = $EnableFileBrowser -eq 'true'
            PingTarget = ""
            PingTimeoutMs = 800
            PingWindowSize = 10
            LogMaxBytes = 65536
            LogMinSecondsBetweenRequests = 1
            ScriptMaxOutputBytes = 65536
            ScriptMaxDurationSeconds = 60
            ScriptMinSecondsBetweenRuns = 1
            TerminalMaxOutputBytes = 65536
            TerminalMaxDurationSeconds = 600
            FileBrowserMaxBytes = 2097152
            FileZipMaxUncompressedBytes = 1073741824
            FileZipMaxFileCount = 10000
            AgentLogFilePath = ""
            AgentLogFileMaxBytes = 5242880
            AgentLogFileRetainedFiles = 3
        }
    }
    $config | ConvertTo-Json -Depth 5 | Set-Content $configPath -Encoding UTF8
}

# Create runner
$effectiveAgentVersion = $null
if (-not [string]::IsNullOrWhiteSpace($AgentVersion) -and $AgentVersion -ne 'staged') {
    $effectiveAgentVersion = $AgentVersion
} elseif (-not [string]::IsNullOrWhiteSpace($GitHubVersion)) {
    $effectiveAgentVersion = $GitHubVersion
}

$runnerContent = @"
`$env:MANLAB_SERVER_URL = '$hubUrl'
`$env:MANLAB_AUTH_TOKEN = '$AuthToken'
"@

if ($effectiveAgentVersion) {
    $runnerContent += "`$env:MANLAB_AGENT_VERSION = '$effectiveAgentVersion'`r`n"
}

$runnerContent += @"
`$exe = Join-Path `$PSScriptRoot 'manlab-agent.exe'
`$log = Join-Path `$PSScriptRoot 'agent.log'
"[`$(Get-Date -Format o)] Starting" | Add-Content `$log
& cmd.exe /d /c "`"`$exe`" >> `"`$log`" 2>&1"
"@
$runnerContent | Set-Content $runnerPath -Encoding UTF8

# Create task
Write-Info "Creating scheduled task..."
$psArgs = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runnerPath`""
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $psArgs

if ($UserMode) {
    $userId = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userId
    $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType InteractiveToken -RunLevel Limited
} else {
    $trigger = New-ScheduledTaskTrigger -AtStartup
    $principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest
}

$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable
$task = New-ScheduledTask -Action $action -Trigger $trigger -Principal $principal -Settings $settings
Register-ScheduledTask -TaskName $TaskName -InputObject $task -Force | Out-Null
Start-ScheduledTask -TaskName $TaskName | Out-Null

Write-Info "Installation complete!"
Write-Info "Logs: $logPath"
