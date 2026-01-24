namespace ManLab.Server.Services.Network;

/// <summary>
/// Service interface for network scanning and discovery operations.
/// </summary>
public interface INetworkScannerService
{
    /// <summary>
    /// Pings a single host.
    /// </summary>
    /// <param name="host">Hostname or IP address to ping.</param>
    /// <param name="timeout">Timeout in milliseconds (default: 1000).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The ping result.</returns>
    Task<PingResult> PingAsync(string host, int timeout = 1000, CancellationToken ct = default);
    
    /// <summary>
    /// Scans a subnet for active hosts, streaming results as they are discovered.
    /// </summary>
    /// <param name="cidr">CIDR notation of subnet to scan (e.g., "192.168.1.0/24").</param>
    /// <param name="concurrencyLimit">Maximum concurrent pings (default: 100).</param>
    /// <param name="timeout">Timeout per host in milliseconds (default: 500).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Stream of discovered hosts.</returns>
    IAsyncEnumerable<DiscoveredHost> ScanSubnetAsync(
        string cidr,
        int concurrencyLimit = 100,
        int timeout = 500,
        CancellationToken ct = default);
    
    /// <summary>
    /// Traces the route to a remote host.
    /// </summary>
    /// <param name="hostname">Target hostname or IP address.</param>
    /// <param name="maxHops">Maximum number of hops (default: 30).</param>
    /// <param name="timeout">Timeout per hop in milliseconds (default: 1000).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The traceroute result.</returns>
    Task<TracerouteResult> TraceRouteAsync(
        string hostname,
        int maxHops = 30,
        int timeout = 1000,
        CancellationToken ct = default,
        Func<TracerouteHop, int, Task>? onHop = null);
    
    /// <summary>
    /// Scans ports on a target host.
    /// </summary>
    /// <param name="host">Target hostname or IP address.</param>
    /// <param name="ports">Ports to scan (null for common ports).</param>
    /// <param name="concurrency">Maximum concurrent connections (default: 50).</param>
    /// <param name="timeout">Timeout per port in milliseconds (default: 2000).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The port scan result.</returns>
    Task<PortScanResult> ScanPortsAsync(
        string host,
        int[]? ports = null,
        int concurrency = 50,
        int timeout = 2000,
        CancellationToken ct = default);
    
    /// <summary>
    /// Gets device information for an IP address.
    /// </summary>
    /// <param name="ip">IP address to query.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Device information.</returns>
    Task<DeviceInfo> GetDeviceInfoAsync(string ip, CancellationToken ct = default);

    /// <summary>
    /// Performs DNS lookups for common record types and reverse DNS.
    /// </summary>
    /// <param name="query">Hostname or IP address.</param>
    /// <param name="includeReverse">Whether to perform reverse lookups for IPs.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>DNS lookup result.</returns>
    Task<DnsLookupResult> DnsLookupAsync(string query, bool includeReverse = true, CancellationToken ct = default);

    /// <summary>
    /// Checks DNS propagation across multiple resolvers.
    /// </summary>
    /// <param name="query">Hostname to query.</param>
    /// <param name="servers">DNS resolvers to query.</param>
    /// <param name="recordTypes">Record types to request.</param>
    /// <param name="timeoutMs">Per-query timeout in milliseconds.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>DNS propagation result.</returns>
    Task<DnsPropagationResult> DnsPropagationCheckAsync(
        string query,
        IReadOnlyList<string> servers,
        IReadOnlyList<DnsRecordType> recordTypes,
        int timeoutMs = 3000,
        CancellationToken ct = default);

    /// <summary>
    /// Performs a WHOIS lookup for a domain or IP.
    /// </summary>
    /// <param name="query">Domain name or IP address.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>WHOIS result.</returns>
    Task<WhoisResult> WhoisAsync(string query, CancellationToken ct = default);

    /// <summary>
    /// Sends a Wake-on-LAN magic packet to a MAC address.
    /// </summary>
    /// <param name="macAddress">MAC address to wake.</param>
    /// <param name="broadcastAddress">Optional broadcast address (default: 255.255.255.255).</param>
    /// <param name="port">UDP port (default: 9).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Result of the WoL send operation.</returns>
    Task<WolSendResult> SendWakeOnLanAsync(string macAddress, string? broadcastAddress = null, int port = 9, CancellationToken ct = default);

    /// <summary>
    /// Inspects the SSL/TLS certificate chain of a host.
    /// </summary>
    /// <param name="host">Hostname to inspect.</param>
    /// <param name="port">Port to connect to (default 443).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>SSL inspection result.</returns>
    Task<SslInspectionResult> InspectCertificateAsync(string host, int port = 443, CancellationToken ct = default);

    /// <summary>
    /// Retrieves the server's public IP address(es).
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Public IP lookup result.</returns>
    Task<PublicIpResult> GetPublicIpAsync(CancellationToken ct = default);
    
    /// <summary>
    /// Parses a CIDR notation string and returns the IP range.
    /// </summary>
    /// <param name="cidr">CIDR notation (e.g., "192.168.1.0/24").</param>
    /// <returns>Enumerable of IP addresses in the range.</returns>
    IEnumerable<System.Net.IPAddress> ParseCidr(string cidr);
}
