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

# Stamp/overwrite the minimal set of env vars that the generated compose expects.
# Avoid writing secrets into CI artifacts by allowing PgPassword to be blank.
$lines = @(
    "PGPASSWORD=$PgPassword",
    "SERVER_IMAGE=$ServerImage",
    "WEB_IMAGE=$WebImage",
    "SERVER_PORT=$ServerPort"
)

Set-Content -Path $envPath -Value $lines -Encoding UTF8

Write-Host "Wrote '$envPath'."
