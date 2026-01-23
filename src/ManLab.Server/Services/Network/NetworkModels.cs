using System.Net.NetworkInformation;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Result of a ping operation to a single host.
/// </summary>
public record PingResult
{
    /// <summary>
    /// The target address (hostname or IP).
    /// </summary>
    public required string Address { get; init; }
    
    /// <summary>
    /// The resolved IP address (if different from input).
    /// </summary>
    public string? ResolvedAddress { get; init; }
    
    /// <summary>
    /// The ICMP status of the ping.
    /// </summary>
    public IPStatus Status { get; init; }
    
    /// <summary>
    /// The round-trip time in milliseconds.
    /// </summary>
    public long RoundtripTime { get; init; }
    
    /// <summary>
    /// Time-to-live value from the reply.
    /// </summary>
    public int? Ttl { get; init; }
    
    /// <summary>
    /// Whether the ping was successful.
    /// </summary>
    public bool IsSuccess => Status == IPStatus.Success;
    
    /// <summary>
    /// Human-readable status message.
    /// </summary>
    public string StatusMessage => Status.ToString();
}

/// <summary>
/// A host discovered during a subnet scan.
/// </summary>
public record DiscoveredHost
{
    /// <summary>
    /// The IP address of the discovered host.
    /// </summary>
    public required string IpAddress { get; init; }
    
    /// <summary>
    /// The round-trip time in milliseconds.
    /// </summary>
    public long RoundtripTime { get; init; }
    
    /// <summary>
    /// The hostname (if resolved via reverse DNS).
    /// </summary>
    public string? Hostname { get; init; }
    
    /// <summary>
    /// The MAC address (if discovered via ARP).
    /// </summary>
    public string? MacAddress { get; init; }
    
    /// <summary>
    /// The vendor name (from OUI database lookup).
    /// </summary>
    public string? Vendor { get; init; }

    /// <summary>
    /// The inferred device type (best-effort).
    /// </summary>
    public string? DeviceType { get; init; }
    
    /// <summary>
    /// When this host was discovered.
    /// </summary>
    public DateTime DiscoveredAt { get; init; } = DateTime.UtcNow;
}

/// <summary>
/// Result of a subnet discovery scan.
/// </summary>
public record SubnetScanResult
{
    /// <summary>
    /// The CIDR notation of the scanned subnet.
    /// </summary>
    public required string Cidr { get; init; }
    
    /// <summary>
    /// Total number of IPs scanned.
    /// </summary>
    public int TotalScanned { get; init; }
    
    /// <summary>
    /// List of discovered hosts.
    /// </summary>
    public List<DiscoveredHost> Hosts { get; init; } = [];
    
    /// <summary>
    /// When the scan started.
    /// </summary>
    public DateTime StartedAt { get; init; }
    
    /// <summary>
    /// When the scan completed.
    /// </summary>
    public DateTime? CompletedAt { get; init; }
    
    /// <summary>
    /// Duration of the scan in milliseconds.
    /// </summary>
    public long? DurationMs => CompletedAt.HasValue 
        ? (long)(CompletedAt.Value - StartedAt).TotalMilliseconds 
        : null;
    
    /// <summary>
    /// Whether the scan was cancelled.
    /// </summary>
    public bool WasCancelled { get; init; }
}

/// <summary>
/// A hop in a traceroute path.
/// </summary>
public record TracerouteHop
{
    /// <summary>
    /// The hop number (1-based).
    /// </summary>
    public int HopNumber { get; init; }
    
    /// <summary>
    /// The IP address of this hop (null if timed out).
    /// </summary>
    public string? Address { get; init; }
    
    /// <summary>
    /// The hostname of this hop (if resolved).
    /// </summary>
    public string? Hostname { get; init; }
    
    /// <summary>
    /// The round-trip time in milliseconds.
    /// </summary>
    public long RoundtripTime { get; init; }
    
    /// <summary>
    /// The ICMP status.
    /// </summary>
    public IPStatus Status { get; init; }
    
    /// <summary>
    /// Whether this hop timed out.
    /// </summary>
    public bool TimedOut => Status == IPStatus.TimedOut;
    
    /// <summary>
    /// Human-readable status.
    /// </summary>
    public string StatusMessage => Status.ToString();
}

/// <summary>
/// Result of a traceroute operation.
/// </summary>
public record TracerouteResult
{
    /// <summary>
    /// The target hostname.
    /// </summary>
    public required string Hostname { get; init; }
    
    /// <summary>
    /// The resolved IP address of the target.
    /// </summary>
    public string? ResolvedAddress { get; init; }
    
    /// <summary>
    /// List of hops in the route.
    /// </summary>
    public List<TracerouteHop> Hops { get; init; } = [];
    
    /// <summary>
    /// Whether the destination was reached.
    /// </summary>
    public bool ReachedDestination => Hops.Any(h => h.Status == IPStatus.Success);
    
    /// <summary>
    /// Maximum hops allowed in the trace.
    /// </summary>
    public int MaxHops { get; init; }
    
    /// <summary>
    /// Duration of the traceroute in milliseconds.
    /// </summary>
    public long DurationMs { get; init; }
}

/// <summary>
/// Result of a port scan operation.
/// </summary>
public record PortScanResult
{
    /// <summary>
    /// The target host.
    /// </summary>
    public required string Host { get; init; }
    
    /// <summary>
    /// List of open ports discovered.
    /// </summary>
    public List<int> OpenPorts { get; init; } = [];
    
    /// <summary>
    /// Total number of ports scanned.
    /// </summary>
    public int ScannedPorts { get; init; }
    
    /// <summary>
    /// Duration of the scan in milliseconds.
    /// </summary>
    public long DurationMs { get; init; }
}

/// <summary>
/// Information about a discovered device.
/// </summary>
public record DeviceInfo
{
    /// <summary>
    /// The IP address of the device.
    /// </summary>
    public required string IpAddress { get; init; }
    
    /// <summary>
    /// The hostname (if resolved).
    /// </summary>
    public string? Hostname { get; init; }
    
    /// <summary>
    /// The MAC address (if discovered).
    /// </summary>
    public string? MacAddress { get; init; }
    
    /// <summary>
    /// The vendor name (from OUI database).
    /// </summary>
    public string? Vendor { get; init; }

    /// <summary>
    /// The inferred device type (best-effort).
    /// </summary>
    public string? DeviceType { get; init; }
    
    /// <summary>
    /// Response time in milliseconds.
    /// </summary>
    public long? ResponseTimeMs { get; init; }
    
    /// <summary>
    /// List of open ports (if port scan was performed).
    /// </summary>
    public List<int>? OpenPorts { get; init; }
}

/// <summary>
/// Error information for network scan operations.
/// </summary>
public record NetworkScanError
{
    /// <summary>
    /// Error code.
    /// </summary>
    public required string Code { get; init; }
    
    /// <summary>
    /// Human-readable error message.
    /// </summary>
    public required string Message { get; init; }
    
    /// <summary>
    /// Additional error details.
    /// </summary>
    public string? Details { get; init; }
}
