namespace ManLab.Shared.Dtos;

/// <summary>
/// Constants for command types sent from server to agent.
/// </summary>
public static class CommandTypes
{
    // Docker commands
    public const string DockerList = "docker.list";
    public const string DockerRestart = "docker.restart";
    public const string DockerStop = "docker.stop";
    public const string DockerStart = "docker.start";

    // System commands  
    public const string SystemUpdate = "system.update";
}

/// <summary>
/// Payload for Docker container commands.
/// </summary>
public record DockerCommandPayload
{
    /// <summary>
    /// The container ID to operate on.
    /// </summary>
    public string ContainerId { get; init; } = string.Empty;
}

/// <summary>
/// Container information returned from docker.list command.
/// </summary>
public record ContainerInfo
{
    /// <summary>Short container ID.</summary>
    public string Id { get; init; } = string.Empty;

    /// <summary>Container names.</summary>
    public IList<string> Names { get; init; } = [];

    /// <summary>Image name.</summary>
    public string Image { get; init; } = string.Empty;

    /// <summary>Container state (running, exited, etc.).</summary>
    public string State { get; init; } = string.Empty;

    /// <summary>Human-readable status.</summary>
    public string Status { get; init; } = string.Empty;

    /// <summary>Creation timestamp.</summary>
    public DateTime Created { get; init; }
}
