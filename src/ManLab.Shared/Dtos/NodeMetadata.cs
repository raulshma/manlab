namespace ManLab.Shared.Dtos;

/// <summary>
/// Metadata sent by an agent during registration.
/// </summary>
public class NodeMetadata
{
    /// <summary>Hostname of the agent node.</summary>
    public string Hostname { get; set; } = string.Empty;

    /// <summary>IP address of the agent node.</summary>
    public string? IpAddress { get; set; }

    /// <summary>Operating system of the agent node.</summary>
    public string? OS { get; set; }

    /// <summary>Version of the ManLab agent.</summary>
    public string? AgentVersion { get; set; }
}
