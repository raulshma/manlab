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

    /// <summary>
    /// Optional JSON describing agent capabilities (e.g. detected tools, supported features).
    /// Stored as-is by the server (jsonb) so the schema can evolve without breaking AOT.
    /// </summary>
    public string? CapabilitiesJson { get; set; }

    /// <summary>
    /// Optional primary network interface name selected by the agent (e.g. "eth0").
    /// </summary>
    public string? PrimaryInterface { get; set; }

    /// <summary>
    /// MAC address of the primary network interface (for Wake-on-LAN).
    /// Formatted as XX:XX:XX:XX:XX:XX.
    /// </summary>
    public string? MacAddress { get; set; }
}
