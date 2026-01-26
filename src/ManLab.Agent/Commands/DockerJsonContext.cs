using System.Text.Json.Serialization;

namespace ManLab.Agent.Commands;

/// <summary>
/// Result of listing Docker containers.
/// </summary>
public sealed record ContainerInfo(
    string Id,
    IList<string> Names,
    string Image,
    string State,
    string Status,
    DateTime Created);

/// <summary>
/// Error response for Docker operations.
/// </summary>
public sealed record DockerErrorResponse(string Error, string? ContainerId = null);

/// <summary>
/// Success response for Docker container actions.
/// </summary>
public sealed record DockerActionResponse(bool Success, string ContainerId, string Action);

/// <summary>
/// Result for docker.logs.
/// </summary>
public sealed record DockerLogsResult(
    string ContainerId,
    string Content,
    bool Truncated,
    int? Tail,
    string? Since,
    bool Timestamps);

/// <summary>
/// Result for docker.exec.
/// </summary>
public sealed record DockerExecResult(
    string ContainerId,
    int ExitCode,
    string Output,
    string Error,
    bool Success);

/// <summary>
/// Result for docker.stats.
/// </summary>
public sealed record DockerStatsInfo(
    string Id,
    string Name,
    string CpuPercent,
    string MemUsage,
    string MemPercent,
    string NetIO,
    string BlockIO,
    string Pids);

/// <summary>
/// Result for docker compose operations.
/// </summary>
public sealed record DockerComposeActionResponse(
    bool Success,
    string ProjectName,
    string Action,
    string? Output = null);

/// <summary>
/// Raw Docker ps JSON output format.
/// Field names match Docker CLI JSON output exactly (PascalCase).
/// </summary>
public sealed record DockerPsOutput(
    string? ID,
    string? Names,
    string? Image,
    string? State,
    string? Status,
    string? CreatedAt);

/// <summary>
/// Raw Docker stats JSON output format.
/// Field names match Docker CLI JSON output exactly (PascalCase).
/// </summary>
public sealed record DockerStatsOutput(
    string? ID,
    string? Name,
    string? CPUPerc,
    string? MemUsage,
    string? MemPerc,
    string? NetIO,
    string? BlockIO,
    string? PIDs);

/// <summary>
/// Source-generated JSON serializer context for Docker Manager DTOs.
/// Enables Native AOT compatibility by avoiding runtime reflection.
/// </summary>
[JsonSerializable(typeof(ContainerInfo))]
[JsonSerializable(typeof(List<ContainerInfo>))]
[JsonSerializable(typeof(DockerErrorResponse))]
[JsonSerializable(typeof(DockerActionResponse))]
[JsonSerializable(typeof(DockerLogsResult))]
[JsonSerializable(typeof(DockerExecResult))]
[JsonSerializable(typeof(DockerStatsInfo))]
[JsonSerializable(typeof(List<DockerStatsInfo>))]
[JsonSerializable(typeof(DockerComposeActionResponse))]
[JsonSerializable(typeof(DockerPsOutput))]
[JsonSerializable(typeof(DockerStatsOutput))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
public sealed partial class DockerJsonContext : JsonSerializerContext
{
}

/// <summary>
/// Separate context for Docker CLI output parsing (uses case-insensitive matching).
/// Docker CLI outputs property names in PascalCase.
/// </summary>
[JsonSerializable(typeof(DockerPsOutput))]
[JsonSerializable(typeof(DockerStatsOutput))]
[JsonSourceGenerationOptions(PropertyNameCaseInsensitive = true)]
public sealed partial class DockerCliJsonContext : JsonSerializerContext
{
}
