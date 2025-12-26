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
/// Source-generated JSON serializer context for Docker Manager DTOs.
/// Enables Native AOT compatibility by avoiding runtime reflection.
/// </summary>
[JsonSerializable(typeof(ContainerInfo))]
[JsonSerializable(typeof(List<ContainerInfo>))]
[JsonSerializable(typeof(DockerErrorResponse))]
[JsonSerializable(typeof(DockerActionResponse))]
[JsonSourceGenerationOptions(PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase)]
public sealed partial class DockerJsonContext : JsonSerializerContext
{
}
