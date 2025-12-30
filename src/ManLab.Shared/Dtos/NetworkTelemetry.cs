namespace ManLab.Shared.Dtos;

/// <summary>
/// Enhanced network telemetry data.
/// </summary>
public sealed class NetworkTelemetry
{
    /// <summary>Per-interface bandwidth statistics.</summary>
    public List<NetworkInterfaceTelemetry> Interfaces { get; set; } = [];

    /// <summary>Network latency measurements to various targets.</summary>
    public List<LatencyMeasurement> LatencyMeasurements { get; set; } = [];

    /// <summary>Active network connections summary.</summary>
    public ConnectionsSummary? Connections { get; set; }

    /// <summary>Discovered network devices on local network.</summary>
    public List<DiscoveredDevice> DiscoveredDevices { get; set; } = [];

    /// <summary>Timestamp of last device discovery scan.</summary>
    public DateTime? LastDiscoveryScanUtc { get; set; }
}

/// <summary>
/// Per-interface network statistics.
/// </summary>
public sealed class NetworkInterfaceTelemetry
{
    /// <summary>Interface name (e.g., "eth0", "Ethernet").</summary>
    public string Name { get; set; } = string.Empty;

    /// <summary>Interface description.</summary>
    public string? Description { get; set; }

    /// <summary>Interface type (e.g., "Ethernet", "Wireless80211").</summary>
    public string? InterfaceType { get; set; }

    /// <summary>Operational status.</summary>
    public string Status { get; set; } = "Unknown";

    /// <summary>Interface speed in bits per second.</summary>
    public long? SpeedBps { get; set; }

    /// <summary>MAC address.</summary>
    public string? MacAddress { get; set; }

    /// <summary>IPv4 addresses assigned to this interface.</summary>
    public List<string> IPv4Addresses { get; set; } = [];

    /// <summary>IPv6 addresses assigned to this interface.</summary>
    public List<string> IPv6Addresses { get; set; } = [];

    /// <summary>Receive rate in bytes per second.</summary>
    public long? RxBytesPerSec { get; set; }

    /// <summary>Transmit rate in bytes per second.</summary>
    public long? TxBytesPerSec { get; set; }

    /// <summary>Total bytes received since interface start.</summary>
    public long? TotalRxBytes { get; set; }

    /// <summary>Total bytes transmitted since interface start.</summary>
    public long? TotalTxBytes { get; set; }

    /// <summary>Packets received per second.</summary>
    public long? RxPacketsPerSec { get; set; }

    /// <summary>Packets transmitted per second.</summary>
    public long? TxPacketsPerSec { get; set; }

    /// <summary>Receive errors count.</summary>
    public long? RxErrors { get; set; }

    /// <summary>Transmit errors count.</summary>
    public long? TxErrors { get; set; }

    /// <summary>Packets dropped on receive.</summary>
    public long? RxDropped { get; set; }

    /// <summary>Packets dropped on transmit.</summary>
    public long? TxDropped { get; set; }

    /// <summary>Bandwidth utilization percentage (0-100).</summary>
    public float? UtilizationPercent { get; set; }
}

/// <summary>
/// Network latency measurement to a specific target.
/// </summary>
public sealed class LatencyMeasurement
{
    /// <summary>Target hostname or IP address.</summary>
    public string Target { get; set; } = string.Empty;

    /// <summary>Round-trip time in milliseconds.</summary>
    public float? RttMs { get; set; }

    /// <summary>Minimum RTT over the measurement window.</summary>
    public float? MinRttMs { get; set; }

    /// <summary>Maximum RTT over the measurement window.</summary>
    public float? MaxRttMs { get; set; }

    /// <summary>Average RTT over the measurement window.</summary>
    public float? AvgRttMs { get; set; }

    /// <summary>Packet loss percentage (0-100).</summary>
    public float? PacketLossPercent { get; set; }

    /// <summary>Jitter (variation in latency) in milliseconds.</summary>
    public float? JitterMs { get; set; }

    /// <summary>Number of hops to target (if traceroute performed).</summary>
    public int? HopCount { get; set; }
}

/// <summary>
/// Summary of active network connections.
/// </summary>
public sealed class ConnectionsSummary
{
    /// <summary>Total number of established TCP connections.</summary>
    public int TcpEstablished { get; set; }

    /// <summary>Number of TCP connections in TIME_WAIT state.</summary>
    public int TcpTimeWait { get; set; }

    /// <summary>Number of TCP connections in CLOSE_WAIT state.</summary>
    public int TcpCloseWait { get; set; }

    /// <summary>Number of listening TCP ports.</summary>
    public int TcpListening { get; set; }

    /// <summary>Total UDP endpoints.</summary>
    public int UdpEndpoints { get; set; }

    /// <summary>Top connections by remote address (limited to top 10).</summary>
    public List<ConnectionInfo> TopConnections { get; set; } = [];
}

/// <summary>
/// Information about a network connection.
/// </summary>
public sealed class ConnectionInfo
{
    /// <summary>Local endpoint (IP:port).</summary>
    public string LocalEndpoint { get; set; } = string.Empty;

    /// <summary>Remote endpoint (IP:port).</summary>
    public string RemoteEndpoint { get; set; } = string.Empty;

    /// <summary>Connection state.</summary>
    public string State { get; set; } = string.Empty;

    /// <summary>Process ID owning the connection (if available).</summary>
    public int? ProcessId { get; set; }

    /// <summary>Process name owning the connection (if available).</summary>
    public string? ProcessName { get; set; }
}

/// <summary>
/// A discovered network device.
/// </summary>
public sealed class DiscoveredDevice
{
    /// <summary>IP address of the device.</summary>
    public string IpAddress { get; set; } = string.Empty;

    /// <summary>MAC address of the device (if available).</summary>
    public string? MacAddress { get; set; }

    /// <summary>Hostname of the device (if resolved).</summary>
    public string? Hostname { get; set; }

    /// <summary>Device vendor based on MAC OUI (if available).</summary>
    public string? Vendor { get; set; }

    /// <summary>Whether the device responded to ping.</summary>
    public bool IsReachable { get; set; }

    /// <summary>Response time in milliseconds.</summary>
    public float? ResponseTimeMs { get; set; }

    /// <summary>When the device was first discovered.</summary>
    public DateTime FirstSeenUtc { get; set; }

    /// <summary>When the device was last seen.</summary>
    public DateTime LastSeenUtc { get; set; }
}
