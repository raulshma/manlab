Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [string[]]$Rids = @('linux-x64', 'linux-arm64', 'win-x64'),

    # Staging folder consumed by the ManLab.Server BinariesController
    [string]$ServerDistributionRoot
)

# This script is kept as a convenience wrapper; the implementation lives in the
# cross-platform ManLab.Build tool.

# When this script lives under scripts/, $PSScriptRoot is not the repo root.
$repoRoot = Split-Path -Parent $PSScriptRoot
$buildProject = Join-Path $repoRoot 'src\ManLab.Build\ManLab.Build.csproj'

if (-not (Test-Path $buildProject))
{
    throw "Build project not found at: $buildProject"
}

if ([string]::IsNullOrWhiteSpace($ServerDistributionRoot)) {
    $ServerDistributionRoot = (Join-Path $repoRoot 'src\ManLab.Server\Distribution\agent')
}

$ridList = ($Rids -join ',')

Write-Host "Invoking ManLab.Build to publish/stage agent binaries..."
dotnet run --project $buildProject -- `
    --configuration $Configuration `
    --repo-root $repoRoot `
    --rids $ridList `
    --server-distribution-root $ServerDistributionRoot
