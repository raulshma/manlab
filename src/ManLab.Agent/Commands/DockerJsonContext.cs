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
/// Source-generated JSON serializer context for Docker Manager DTOs.
/// Enables Native AOT compatibility by avoiding runtime reflection.
/// </summary>
[JsonSerializable(typeof(ContainerInfo))]
[JsonSerializable(typeof(List<ContainerInfo>))]
[JsonSerializable(typeof(DockerErrorResponse))]
[JsonSerializable(typeof(DockerActionResponse))]
[JsonSerializable(typeof(DockerPsOutput))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
public sealed partial class DockerJsonContext : JsonSerializerContext
{
}

/// <summary>
/// Separate context for Docker CLI output parsing (uses case-insensitive matching).
/// Docker CLI outputs property names in PascalCase.
/// </summary>
[JsonSerializable(typeof(DockerPsOutput))]
[JsonSourceGenerationOptions(PropertyNameCaseInsensitive = true)]
public sealed partial class DockerCliJsonContext : JsonSerializerContext
{
}
