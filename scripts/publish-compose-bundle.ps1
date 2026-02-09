[CmdletBinding()]
param(
    [Parameter()]
    [string]$OutputDir = "aspire-output",

    [Parameter()]
    [string]$ServerImage = "",

    [Parameter()]
    [string]$WebImage = "",

    [Parameter()]
    [string]$PgPassword = "",

    [Parameter()]
    [string]$NatsPassword = "",

    [Parameter()]
    [int]$ServerPort = 8081
)

$ErrorActionPreference = 'Stop'

function Resolve-AspireCommand {
    if (Get-Command aspire -ErrorAction SilentlyContinue) {
        # NOTE: PowerShell will unwrap a single-item array when written to the pipeline.
        # Use the unary comma to force the caller to receive a true 1-element array.
        return ,@('aspire')
    }

    # Some environments may have the Aspire CLI available as a dotnet global tool.
    if (Get-Command dotnet -ErrorAction SilentlyContinue) {
        # dotnet aspire is not guaranteed, but try it if present.
        return ,@('dotnet', 'aspire')
    }

    throw "Unable to find the Aspire CLI. Install it (https://aspire.dev/get-started/install-cli/) so the 'aspire' command is available."
}

# Ensure we always end up with a string[] even when the resolver returns a single string.
$aspireCmd = @((Resolve-AspireCommand))

Write-Host "Publishing Docker Compose bundle to '$OutputDir'..."

# Ensure output directory exists.
New-Item -ItemType Directory -Force -Path $OutputDir | Out-Null

# Run publish.
if ($aspireCmd.Count -eq 1) {
    & $aspireCmd[0] publish -o $OutputDir
} else {
    & $aspireCmd[0] $aspireCmd[1] publish -o $OutputDir
}

$envPath = Join-Path $OutputDir '.env'
$envExamplePath = Join-Path $OutputDir '.env.example'

$postgresMemoryLimit = "512M"
$postgresCpuLimit = "1.50"
$natsMemoryLimit = "96M"
$natsCpuLimit = "0.50"
$valkeyMemoryLimit = "192M"
$valkeyCpuLimit = "0.75"
$serverMemoryLimit = "768M"
$serverCpuLimit = "1.50"
$webMemoryLimit = "128M"
$webCpuLimit = "0.50"
$serverGcHeapHardLimitPercent = "70"
$serverGcConserveMemory = "1"

# Stamp/overwrite the minimal set of env vars that the generated compose expects.
# Avoid writing secrets into CI artifacts by allowing PgPassword to be blank.
$lines = @(
    "PGPASSWORD=$PgPassword",
    "NATS_PASSWORD=$NatsPassword",
    "SERVER_IMAGE=$ServerImage",
    "WEB_IMAGE=$WebImage",
    "SERVER_PORT=$ServerPort",
    "POSTGRES_MEMORY_LIMIT=$postgresMemoryLimit",
    "POSTGRES_CPU_LIMIT=$postgresCpuLimit",
    "NATS_MEMORY_LIMIT=$natsMemoryLimit",
    "NATS_CPU_LIMIT=$natsCpuLimit",
    "VALKEY_MEMORY_LIMIT=$valkeyMemoryLimit",
    "VALKEY_CPU_LIMIT=$valkeyCpuLimit",
    "SERVER_MEMORY_LIMIT=$serverMemoryLimit",
    "SERVER_CPU_LIMIT=$serverCpuLimit",
    "WEB_MEMORY_LIMIT=$webMemoryLimit",
    "WEB_CPU_LIMIT=$webCpuLimit",
    "SERVER_DOTNET_GC_HEAP_HARD_LIMIT_PERCENT=$serverGcHeapHardLimitPercent",
    "SERVER_DOTNET_GC_CONSERVE_MEMORY=$serverGcConserveMemory"
)

Set-Content -Path $envPath -Value $lines -Encoding UTF8

Write-Host "Wrote '$envPath'."

$exampleLines = @(
    "PGPASSWORD=CHANGEME",
    "NATS_PASSWORD=CHANGEME",
    "SERVER_IMAGE=$ServerImage",
    "WEB_IMAGE=$WebImage",
    "SERVER_PORT=$ServerPort",
    "POSTGRES_MEMORY_LIMIT=$postgresMemoryLimit",
    "POSTGRES_CPU_LIMIT=$postgresCpuLimit",
    "NATS_MEMORY_LIMIT=$natsMemoryLimit",
    "NATS_CPU_LIMIT=$natsCpuLimit",
    "VALKEY_MEMORY_LIMIT=$valkeyMemoryLimit",
    "VALKEY_CPU_LIMIT=$valkeyCpuLimit",
    "SERVER_MEMORY_LIMIT=$serverMemoryLimit",
    "SERVER_CPU_LIMIT=$serverCpuLimit",
    "WEB_MEMORY_LIMIT=$webMemoryLimit",
    "WEB_CPU_LIMIT=$webCpuLimit",
    "SERVER_DOTNET_GC_HEAP_HARD_LIMIT_PERCENT=$serverGcHeapHardLimitPercent",
    "SERVER_DOTNET_GC_CONSERVE_MEMORY=$serverGcConserveMemory"
)

Set-Content -Path $envExamplePath -Value $exampleLines -Encoding UTF8

Write-Host "Wrote '$envExamplePath'."
