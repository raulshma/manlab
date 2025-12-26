Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

param(
    [ValidateSet('Debug', 'Release')]
    [string]$Configuration = 'Release',

    [string[]]$Rids = @('linux-x64', 'linux-arm64', 'win-x64'),

    # Staging folder consumed by the ManLab.Server BinariesController
    [string]$ServerDistributionRoot = (Join-Path $PSScriptRoot 'src\ManLab.Server\Distribution\agent')
)

# This script is kept as a convenience wrapper; the implementation lives in the
# cross-platform ManLab.Build tool.
$repoRoot = $PSScriptRoot
$buildProject = Join-Path $repoRoot 'src\ManLab.Build\ManLab.Build.csproj'

if (-not (Test-Path $buildProject))
{
    throw "Build project not found at: $buildProject"
}

$ridList = ($Rids -join ',')

Write-Host "Invoking ManLab.Build to publish/stage agent binaries..."
dotnet run --project $buildProject -- `
    --configuration $Configuration `
    --repo-root $repoRoot `
    --rids $ridList `
    --server-distribution-root $ServerDistributionRoot
