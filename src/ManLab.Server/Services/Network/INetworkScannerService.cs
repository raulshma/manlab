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
    /// Parses a CIDR notation string and returns the IP range.
    /// </summary>
    /// <param name="cidr">CIDR notation (e.g., "192.168.1.0/24").</param>
    /// <returns>Enumerable of IP addresses in the range.</returns>
    IEnumerable<System.Net.IPAddress> ParseCidr(string cidr);
}
