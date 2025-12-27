namespace ManLab.Shared.Dtos;

/// <summary>
/// Payload broadcast to dashboard clients when a node is registered.
/// Must be a concrete type (not an anonymous object) so it can be included in
/// System.Text.Json source-generation metadata used by SignalR.
/// </summary>
public sealed record NodeRegisteredDto
{
    public Guid Id { get; init; }
    public string Hostname { get; init; } = string.Empty;
    public string? IpAddress { get; init; }
    public string? OS { get; init; }
    public string? AgentVersion { get; init; }
    public DateTime LastSeen { get; init; }
    public string Status { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
}
