namespace ManLab.Server.Services.Network;

/// <summary>
/// Request to build a network topology map.
/// </summary>
public sealed record NetworkTopologyRequest
{
    /// <summary>
    /// CIDR notation of the subnet to scan (e.g., 192.168.1.0/24).
    /// </summary>
    public string Cidr { get; init; } = string.Empty;

    /// <summary>
    /// Maximum concurrent ping operations during subnet scan.
    /// </summary>
    public int? ConcurrencyLimit { get; init; }

    /// <summary>
    /// Ping timeout in milliseconds.
    /// </summary>
    public int? Timeout { get; init; }

    /// <summary>
    /// Whether to include mDNS/UPnP discovery results.
    /// </summary>
    public bool? IncludeDiscovery { get; init; }

    /// <summary>
    /// How long to run discovery in seconds.
    /// </summary>
    public int? DiscoveryDurationSeconds { get; init; }
}

/// <summary>
/// Summary statistics for a topology run.
/// </summary>
public sealed record NetworkTopologySummary
{
    public int SubnetCount { get; init; }
    public int HostCount { get; init; }
    public int DiscoveryOnlyHosts { get; init; }
    public int MdnsServices { get; init; }
    public int UpnpDevices { get; init; }
    public int TotalNodes { get; init; }
    public int TotalLinks { get; init; }
}

/// <summary>
/// Node in the topology graph.
/// </summary>
public sealed record NetworkTopologyNode
{
    public required string Id { get; init; }
    public required string Kind { get; init; }
    public required string Label { get; init; }
    public string? IpAddress { get; init; }
    public string? Hostname { get; init; }
    public string? MacAddress { get; init; }
    public string? Vendor { get; init; }
    public string? DeviceType { get; init; }
    public string? Subnet { get; init; }
    public string? Source { get; init; }
    public string? ServiceType { get; init; }
    public int? Port { get; init; }
}

/// <summary>
/// Link between two nodes in the topology graph.
/// </summary>
public sealed record NetworkTopologyLink
{
    public required string Source { get; init; }
    public required string Target { get; init; }
    public required string Kind { get; init; }
}

/// <summary>
/// Result of a topology build request.
/// </summary>
public sealed record NetworkTopologyResult
{
    public required string Cidr { get; init; }
    public List<NetworkTopologyNode> Nodes { get; init; } = [];
    public List<NetworkTopologyLink> Links { get; init; } = [];
    public DateTime StartedAt { get; init; }
    public DateTime CompletedAt { get; init; }
    public NetworkTopologySummary Summary { get; init; } = new();
}
