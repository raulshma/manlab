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

/// <summary>
/// DNS record types supported by the DNS lookup tool.
/// </summary>
public enum DnsRecordType
{
    A,
    AAAA,
    CNAME,
    MX,
    TXT,
    NS,
    SOA,
    PTR
}

/// <summary>
/// Represents a single DNS record.
/// </summary>
public record DnsRecord
{
    /// <summary>
    /// Record name (owner).
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// DNS record type.
    /// </summary>
    public required DnsRecordType Type { get; init; }

    /// <summary>
    /// Record value (string representation).
    /// </summary>
    public required string Value { get; init; }

    /// <summary>
    /// TTL in seconds.
    /// </summary>
    public int? Ttl { get; init; }

    /// <summary>
    /// Priority (for MX records).
    /// </summary>
    public int? Priority { get; init; }
}

/// <summary>
/// Result of a DNS lookup operation.
/// </summary>
public record DnsLookupResult
{
    /// <summary>
    /// Original query (hostname or IP).
    /// </summary>
    public required string Query { get; init; }

    /// <summary>
    /// DNS records returned for the query.
    /// </summary>
    public List<DnsRecord> Records { get; init; } = [];

    /// <summary>
    /// Reverse lookup records for resolved IPs (PTR).
    /// </summary>
    public List<DnsRecord> ReverseRecords { get; init; } = [];
}

/// <summary>
/// Result of a WHOIS lookup.
/// </summary>
public record WhoisResult
{
    /// <summary>
    /// Original query.
    /// </summary>
    public required string Query { get; init; }

    /// <summary>
    /// WHOIS server used.
    /// </summary>
    public string? Server { get; init; }

    /// <summary>
    /// Raw WHOIS response.
    /// </summary>
    public required string Response { get; init; }
}

/// <summary>
/// Result of a Wake-on-LAN request.
/// </summary>
public record WolSendResult
{
    /// <summary>
    /// MAC address that was targeted.
    /// </summary>
    public required string MacAddress { get; init; }

    /// <summary>
    /// Broadcast address used.
    /// </summary>
    public required string BroadcastAddress { get; init; }

    /// <summary>
    /// UDP port used.
    /// </summary>
    public int Port { get; init; }

    /// <summary>
    /// Whether the packet was sent successfully.
    /// </summary>
    public bool Success { get; init; }

    /// <summary>
    /// Error message if send failed.
    /// </summary>
    public string? Error { get; init; }
}

/// <summary>
/// Result of a MAC vendor lookup.
/// </summary>
public record MacVendorLookupResult
{
    /// <summary>
    /// Normalized MAC address (XX:XX:XX:XX:XX:XX).
    /// </summary>
    public required string MacAddress { get; init; }

    /// <summary>
    /// Vendor name, if known.
    /// </summary>
    public string? Vendor { get; init; }

    /// <summary>
    /// Total number of vendors in the database.
    /// </summary>
    public int VendorCount { get; init; }
}

/// <summary>
/// Request for a speed test run.
/// </summary>
public record SpeedTestRequest
{
    /// <summary>
    /// Download size in bytes (optional).
    /// </summary>
    public int? DownloadSizeBytes { get; init; }

    /// <summary>
    /// Upload size in bytes (optional).
    /// </summary>
    public int? UploadSizeBytes { get; init; }

    /// <summary>
    /// Number of latency samples to measure (optional).
    /// </summary>
    public int? LatencySamples { get; init; }
}

/// <summary>
/// Result of an internet speed test.
/// </summary>
public record SpeedTestResult
{
    /// <summary>
    /// When the test started (UTC).
    /// </summary>
    public DateTime StartedAt { get; init; }

    /// <summary>
    /// When the test completed (UTC).
    /// </summary>
    public DateTime CompletedAt { get; init; }

    /// <summary>
    /// Whether the test completed successfully.
    /// </summary>
    public bool Success { get; init; }

    /// <summary>
    /// Download throughput in Mbps.
    /// </summary>
    public double? DownloadMbps { get; init; }

    /// <summary>
    /// Upload throughput in Mbps.
    /// </summary>
    public double? UploadMbps { get; init; }

    /// <summary>
    /// Total bytes downloaded during the test.
    /// </summary>
    public long DownloadBytes { get; init; }

    /// <summary>
    /// Total bytes uploaded during the test.
    /// </summary>
    public long UploadBytes { get; init; }

    /// <summary>
    /// Minimum measured latency in milliseconds.
    /// </summary>
    public double? LatencyMinMs { get; init; }

    /// <summary>
    /// Average measured latency in milliseconds.
    /// </summary>
    public double? LatencyAvgMs { get; init; }

    /// <summary>
    /// Maximum measured latency in milliseconds.
    /// </summary>
    public double? LatencyMaxMs { get; init; }

    /// <summary>
    /// Latency jitter (standard deviation) in milliseconds.
    /// </summary>
    public double? JitterMs { get; init; }

    /// <summary>
    /// Download size requested in bytes.
    /// </summary>
    public int DownloadSizeBytes { get; init; }

    /// <summary>
    /// Upload size requested in bytes.
    /// </summary>
    public int UploadSizeBytes { get; init; }

    /// <summary>
    /// Latency sample count requested.
    /// </summary>
    public int LatencySamples { get; init; }

    /// <summary>
    /// Locate service URL used for ndt7 discovery.
    /// </summary>
    public string? LocateUrl { get; init; }

    /// <summary>
    /// Download test URL used for the ndt7 session.
    /// </summary>
    public string? DownloadUrl { get; init; }

    /// <summary>
    /// Upload test URL used for the ndt7 session.
    /// </summary>
    public string? UploadUrl { get; init; }

    /// <summary>
    /// Locate service name (e.g. ndt).
    /// </summary>
    public string? ServiceName { get; init; }

    /// <summary>
    /// Locate service type (e.g. ndt7).
    /// </summary>
    public string? ServiceType { get; init; }

    /// <summary>
    /// Client name metadata.
    /// </summary>
    public string? ClientName { get; init; }

    /// <summary>
    /// Client version metadata.
    /// </summary>
    public string? ClientVersion { get; init; }

    /// <summary>
    /// Client library name metadata.
    /// </summary>
    public string? ClientLibraryName { get; init; }

    /// <summary>
    /// Client library version metadata.
    /// </summary>
    public string? ClientLibraryVersion { get; init; }

    /// <summary>
    /// Total duration of the test in milliseconds.
    /// </summary>
    public long DurationMs => (long)(CompletedAt - StartedAt).TotalMilliseconds;

    /// <summary>
    /// Error message if the test failed.
    /// </summary>
    public string? Error { get; init; }
}

/// <summary>
/// Metadata describing the active speed test session.
/// </summary>
public record SpeedTestMetadata
{
    public int DownloadSizeBytes { get; init; }
    public int UploadSizeBytes { get; init; }
    public int LatencySamples { get; init; }
    public string? LocateUrl { get; init; }
    public string? DownloadUrl { get; init; }
    public string? UploadUrl { get; init; }
    public string? ServiceName { get; init; }
    public string? ServiceType { get; init; }
    public string? ClientName { get; init; }
    public string? ClientVersion { get; init; }
    public string? ClientLibraryName { get; init; }
    public string? ClientLibraryVersion { get; init; }
}

/// <summary>
/// Progress update for an active speed test phase.
/// </summary>
public record SpeedTestProgress
{
    public required string Phase { get; init; }
    public long BytesTransferred { get; init; }
    public int TargetBytes { get; init; }
    public double? Mbps { get; init; }
    public double? LatencySampleMs { get; init; }
    public int LatencySamplesCollected { get; init; }
    public int LatencySamplesTarget { get; init; }
    public long ElapsedMs { get; init; }
}

/// <summary>
/// Combined speed test update payload for real-time UI.
/// </summary>
public record SpeedTestProgressUpdate
{
    public SpeedTestMetadata? Metadata { get; init; }
    public SpeedTestProgress? Progress { get; init; }
    public DateTime TimestampUtc { get; init; } = DateTime.UtcNow;
}

/// <summary>
/// SSL/TLS certificate details.
/// </summary>
public record SslCertificateInfo
{
    /// <summary>
    /// Certificate subject.
    /// </summary>
    public required string Subject { get; init; }

    /// <summary>
    /// Certificate issuer.
    /// </summary>
    public required string Issuer { get; init; }

    /// <summary>
    /// NotBefore validity date.
    /// </summary>
    public DateTime NotBefore { get; init; }

    /// <summary>
    /// NotAfter validity date.
    /// </summary>
    public DateTime NotAfter { get; init; }

    /// <summary>
    /// Certificate thumbprint.
    /// </summary>
    public required string Thumbprint { get; init; }

    /// <summary>
    /// Certificate serial number.
    /// </summary>
    public required string SerialNumber { get; init; }

    /// <summary>
    /// Subject Alternative Names.
    /// </summary>
    public List<string> SubjectAlternativeNames { get; init; } = [];

    /// <summary>
    /// Signature algorithm.
    /// </summary>
    public string? SignatureAlgorithm { get; init; }

    /// <summary>
    /// Public key algorithm.
    /// </summary>
    public string? PublicKeyAlgorithm { get; init; }

    /// <summary>
    /// Public key size (bits).
    /// </summary>
    public int? KeySize { get; init; }

    /// <summary>
    /// Whether certificate is self-signed.
    /// </summary>
    public bool IsSelfSigned { get; init; }
}

/// <summary>
/// SSL/TLS inspection result.
/// </summary>
public record SslInspectionResult
{
    /// <summary>
    /// Hostname inspected.
    /// </summary>
    public required string Host { get; init; }

    /// <summary>
    /// Port inspected.
    /// </summary>
    public int Port { get; init; }

    /// <summary>
    /// When inspection occurred.
    /// </summary>
    public DateTime RetrievedAt { get; init; }

    /// <summary>
    /// Certificate chain (leaf first).
    /// </summary>
    public List<SslCertificateInfo> Chain { get; init; } = [];

    /// <summary>
    /// Days remaining before leaf expires.
    /// </summary>
    public int DaysRemaining { get; init; }

    /// <summary>
    /// Whether the leaf certificate is currently valid.
    /// </summary>
    public bool IsValidNow { get; init; }
}
