using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Network;
using Microsoft.AspNetCore.Mvc;
using System.Net;

namespace ManLab.Server.Controllers;

/// <summary>
/// REST API controller for network scanning and discovery operations.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class NetworkController : ControllerBase
{
    private readonly INetworkScannerService _scanner;
    private readonly IDeviceDiscoveryService _discovery;
    private readonly IWifiScannerService _wifiScanner;
    private readonly ILogger<NetworkController> _logger;
    private readonly IAuditLog _audit;

    public NetworkController(
        INetworkScannerService scanner,
        IDeviceDiscoveryService discovery,
        IWifiScannerService wifiScanner,
        ILogger<NetworkController> logger,
        IAuditLog audit)
    {
        _scanner = scanner;
        _discovery = discovery;
        _wifiScanner = wifiScanner;
        _logger = logger;
        _audit = audit;
    }

    /// <summary>
    /// Pings a single host.
    /// </summary>
    /// <param name="request">The ping request.</param>
    /// <returns>The ping result.</returns>
    [HttpPost("ping")]
    public async Task<ActionResult<PingResult>> Ping([FromBody] PingRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Host))
        {
            return BadRequest(new NetworkScanError
            {
                Code = "INVALID_HOST",
                Message = "Host is required"
            });
        }

        var timeout = Math.Clamp(request.Timeout ?? 1000, 100, 10000);

        try
        {
            var result = await _scanner.PingAsync(request.Host, timeout, ct);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "network.ping",
                httpContext: HttpContext,
                success: result.IsSuccess,
                statusCode: 200,
                category: "network",
                message: $"Ping to {request.Host}: {result.StatusMessage}"));

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Ping failed for host {Host}", request.Host);
            return StatusCode(500, new NetworkScanError
            {
                Code = "PING_FAILED",
                Message = "Ping operation failed",
                Details = ex.Message
            });
        }
    }

    /// <summary>
    /// Discovers active hosts on a subnet.
    /// </summary>
    /// <param name="request">The subnet scan request.</param>
    /// <returns>List of discovered hosts.</returns>
    [HttpPost("discover")]
    public async Task<ActionResult<SubnetScanResult>> DiscoverSubnet([FromBody] SubnetScanRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Cidr))
        {
            return BadRequest(new NetworkScanError
            {
                Code = "INVALID_CIDR",
                Message = "CIDR notation is required (e.g., 192.168.1.0/24)"
            });
        }

        // Validate CIDR format
        if (!TryValidateCidr(request.Cidr, out var errorMessage))
        {
            return BadRequest(new NetworkScanError
            {
                Code = "INVALID_CIDR",
                Message = errorMessage
            });
        }

        // Restrict to private IP ranges for security
        if (!IsPrivateNetwork(request.Cidr))
        {
            return BadRequest(new NetworkScanError
            {
                Code = "SCAN_RESTRICTED",
                Message = "Only private network ranges are allowed (10.x.x.x, 172.16-31.x.x, 192.168.x.x)"
            });
        }

        var concurrency = Math.Clamp(request.ConcurrencyLimit ?? 100, 10, 200);
        var timeout = Math.Clamp(request.Timeout ?? 500, 100, 5000);
        var startedAt = DateTime.UtcNow;

        try
        {
            var hosts = new List<DiscoveredHost>();
            var totalScanned = 0;

            // Count hosts to scan
            try
            {
                totalScanned = _scanner.ParseCidr(request.Cidr).Count();
            }
            catch (ArgumentException)
            {
                return BadRequest(new NetworkScanError
                {
                    Code = "INVALID_CIDR",
                    Message = "Unable to parse CIDR range"
                });
            }

            await foreach (var host in _scanner.ScanSubnetAsync(request.Cidr, concurrency, timeout, ct))
            {
                hosts.Add(host);
            }

            var result = new SubnetScanResult
            {
                Cidr = request.Cidr,
                TotalScanned = totalScanned,
                Hosts = hosts.OrderBy(h => IPAddress.Parse(h.IpAddress).GetAddressBytes(), new IpAddressComparer()).ToList(),
                StartedAt = startedAt,
                CompletedAt = DateTime.UtcNow,
                WasCancelled = false
            };

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "network.discover",
                httpContext: HttpContext,
                success: true,
                statusCode: 200,
                category: "network",
                message: $"Subnet scan of {request.Cidr}: {hosts.Count} hosts found"));

            return Ok(result);
        }
        catch (OperationCanceledException)
        {
            return Ok(new SubnetScanResult
            {
                Cidr = request.Cidr,
                TotalScanned = 0,
                StartedAt = startedAt,
                CompletedAt = DateTime.UtcNow,
                WasCancelled = true
            });
        }
        catch (ArgumentException ex)
        {
            return BadRequest(new NetworkScanError
            {
                Code = "INVALID_CIDR",
                Message = ex.Message
            });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Subnet scan failed for {Cidr}", request.Cidr);
            return StatusCode(500, new NetworkScanError
            {
                Code = "SCAN_FAILED",
                Message = "Subnet scan failed",
                Details = ex.Message
            });
        }
    }

    /// <summary>
    /// Traces the route to a remote host.
    /// </summary>
    /// <param name="request">The traceroute request.</param>
    /// <returns>The traceroute result.</returns>
    [HttpPost("traceroute")]
    public async Task<ActionResult<TracerouteResult>> Traceroute([FromBody] TracerouteRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Host))
        {
            return BadRequest(new NetworkScanError
            {
                Code = "INVALID_HOST",
                Message = "Host is required"
            });
        }

        var maxHops = Math.Clamp(request.MaxHops ?? 30, 1, 64);
        var timeout = Math.Clamp(request.Timeout ?? 1000, 100, 5000);

        try
        {
            var result = await _scanner.TraceRouteAsync(request.Host, maxHops, timeout, ct);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "network.traceroute",
                httpContext: HttpContext,
                success: result.ReachedDestination,
                statusCode: 200,
                category: "network",
                message: $"Traceroute to {request.Host}: {result.Hops.Count} hops, reached: {result.ReachedDestination}"));

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Traceroute failed for host {Host}", request.Host);
            return StatusCode(500, new NetworkScanError
            {
                Code = "TRACEROUTE_FAILED",
                Message = "Traceroute operation failed",
                Details = ex.Message
            });
        }
    }

    /// <summary>
    /// Scans ports on a target host.
    /// </summary>
    /// <param name="request">The port scan request.</param>
    /// <returns>The port scan result.</returns>
    [HttpPost("ports")]
    public async Task<ActionResult<PortScanResult>> ScanPorts([FromBody] PortScanRequest request, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(request.Host))
        {
            return BadRequest(new NetworkScanError
            {
                Code = "INVALID_HOST",
                Message = "Host is required"
            });
        }

        // Validate host is a private IP or localhost for security
        if (!IsAllowedHostForPortScan(request.Host))
        {
            return BadRequest(new NetworkScanError
            {
                Code = "SCAN_RESTRICTED",
                Message = "Port scanning is only allowed for private network hosts"
            });
        }

        var ports = request.Ports;
        if (ports is not null && ports.Length > 1000)
        {
            return BadRequest(new NetworkScanError
            {
                Code = "TOO_MANY_PORTS",
                Message = "Maximum 1000 ports allowed per scan"
            });
        }

        var concurrency = Math.Clamp(request.Concurrency ?? 50, 10, 100);
        var timeout = Math.Clamp(request.Timeout ?? 2000, 100, 10000);

        try
        {
            var result = await _scanner.ScanPortsAsync(request.Host, ports, concurrency, timeout, ct);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "network.portscan",
                httpContext: HttpContext,
                success: true,
                statusCode: 200,
                category: "network",
                message: $"Port scan of {request.Host}: {result.OpenPorts.Count} open ports found"));

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Port scan failed for host {Host}", request.Host);
            return StatusCode(500, new NetworkScanError
            {
                Code = "PORTSCAN_FAILED",
                Message = "Port scan operation failed",
                Details = ex.Message
            });
        }
    }

    /// <summary>
    /// Gets device information for an IP address.
    /// </summary>
    /// <param name="ip">The IP address.</param>
    /// <returns>Device information.</returns>
    [HttpGet("device/{ip}")]
    public async Task<ActionResult<DeviceInfo>> GetDeviceInfo(string ip, CancellationToken ct)
    {
        if (string.IsNullOrWhiteSpace(ip) || !IPAddress.TryParse(ip, out _))
        {
            return BadRequest(new NetworkScanError
            {
                Code = "INVALID_IP",
                Message = "Valid IP address is required"
            });
        }

        try
        {
            var result = await _scanner.GetDeviceInfoAsync(ip, ct);
            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get device info for {IP}", ip);
            return StatusCode(500, new NetworkScanError
            {
                Code = "DEVICE_INFO_FAILED",
                Message = "Failed to get device information",
                Details = ex.Message
            });
        }
    }

    /// <summary>
    /// Discovers devices on the local network using mDNS and UPnP/SSDP.
    /// </summary>
    /// <param name="request">The discovery request.</param>
    /// <returns>List of discovered devices.</returns>
    [HttpPost("discovery")]
    public async Task<ActionResult<DiscoveryScanResult>> DiscoverDevices([FromBody] DeviceDiscoveryRequest? request, CancellationToken ct)
    {
        var scanDuration = Math.Clamp(request?.ScanDurationSeconds ?? 5, 1, 30);

        try
        {
            var result = await _discovery.DiscoverAllAsync(scanDuration, ct);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "network.discovery",
                httpContext: HttpContext,
                success: true,
                statusCode: 200,
                category: "network",
                message: $"Device discovery: {result.MdnsDevices.Count} mDNS, {result.UpnpDevices.Count} UPnP devices found"));

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Device discovery failed");
            return StatusCode(500, new NetworkScanError
            {
                Code = "DISCOVERY_FAILED",
                Message = "Device discovery operation failed",
                Details = ex.Message
            });
        }
    }

    /// <summary>
    /// Discovers devices via mDNS (Bonjour/Avahi).
    /// </summary>
    /// <param name="request">The mDNS discovery request.</param>
    /// <returns>List of discovered mDNS devices.</returns>
    [HttpPost("discovery/mdns")]
    public async Task<ActionResult<List<MdnsDiscoveredDevice>>> DiscoverMdns([FromBody] MdnsDiscoveryRequest? request, CancellationToken ct)
    {
        var scanDuration = Math.Clamp(request?.ScanDurationSeconds ?? 5, 1, 30);
        var serviceTypes = request?.ServiceTypes;

        try
        {
            var result = await _discovery.DiscoverMdnsAsync(serviceTypes, scanDuration, ct);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "network.discovery.mdns",
                httpContext: HttpContext,
                success: true,
                statusCode: 200,
                category: "network",
                message: $"mDNS discovery: {result.Count} devices found"));

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "mDNS discovery failed");
            return StatusCode(500, new NetworkScanError
            {
                Code = "MDNS_DISCOVERY_FAILED",
                Message = "mDNS discovery operation failed",
                Details = ex.Message
            });
        }
    }

    /// <summary>
    /// Discovers devices via UPnP/SSDP.
    /// </summary>
    /// <param name="request">The UPnP discovery request.</param>
    /// <returns>List of discovered UPnP devices.</returns>
    [HttpPost("discovery/upnp")]
    public async Task<ActionResult<List<UpnpDiscoveredDevice>>> DiscoverUpnp([FromBody] UpnpDiscoveryRequest? request, CancellationToken ct)
    {
        var scanDuration = Math.Clamp(request?.ScanDurationSeconds ?? 5, 1, 30);
        var searchTarget = request?.SearchTarget;

        try
        {
            var result = await _discovery.DiscoverUpnpAsync(searchTarget, scanDuration, ct);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "network.discovery.upnp",
                httpContext: HttpContext,
                success: true,
                statusCode: 200,
                category: "network",
                message: $"UPnP discovery: {result.Count} devices found"));

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "UPnP discovery failed");
            return StatusCode(500, new NetworkScanError
            {
                Code = "UPNP_DISCOVERY_FAILED",
                Message = "UPnP discovery operation failed",
                Details = ex.Message
            });
        }
    }

    /// <summary>
    /// Gets the list of common mDNS service types.
    /// </summary>
    /// <returns>List of common mDNS service types.</returns>
    [HttpGet("discovery/mdns/service-types")]
    public ActionResult<string[]> GetMdnsServiceTypes()
    {
        return Ok(MdnsServiceTypes.CommonTypes);
    }

    /// <summary>
    /// Gets whether WiFi scanning is supported on this host.
    /// </summary>
    /// <returns>WiFi scanning support status.</returns>
    [HttpGet("wifi/supported")]
    public ActionResult<object> IsWifiSupported()
    {
        return Ok(new 
        { 
            IsSupported = _wifiScanner.IsSupported,
            Platform = OperatingSystem.IsWindows() ? "Windows" : 
                       OperatingSystem.IsLinux() ? "Linux" : "Unsupported"
        });
    }

    /// <summary>
    /// Gets available WiFi adapters.
    /// </summary>
    /// <returns>List of WiFi adapters.</returns>
    [HttpGet("wifi/adapters")]
    public async Task<ActionResult<List<WifiAdapter>>> GetWifiAdapters(CancellationToken ct)
    {
        if (!_wifiScanner.IsSupported)
        {
            return BadRequest(new NetworkScanError
            {
                Code = "WIFI_NOT_SUPPORTED",
                Message = "WiFi scanning is not supported on this platform"
            });
        }

        try
        {
            var adapters = await _wifiScanner.GetAdaptersAsync(ct);
            return Ok(adapters);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get WiFi adapters");
            return StatusCode(500, new NetworkScanError
            {
                Code = "WIFI_ADAPTERS_FAILED",
                Message = "Failed to get WiFi adapters",
                Details = ex.Message
            });
        }
    }

    /// <summary>
    /// Scans for available WiFi networks.
    /// </summary>
    /// <param name="request">The WiFi scan request.</param>
    /// <returns>WiFi scan result.</returns>
    [HttpPost("wifi/scan")]
    public async Task<ActionResult<WifiScanResult>> ScanWifi([FromBody] WifiScanRequest? request, CancellationToken ct)
    {
        if (!_wifiScanner.IsSupported)
        {
            return Ok(new WifiScanResult
            {
                StartedAt = DateTime.UtcNow,
                CompletedAt = DateTime.UtcNow,
                Success = false,
                ErrorMessage = "WiFi scanning is not supported on this platform",
                Platform = OperatingSystem.IsWindows() ? "Windows" : 
                           OperatingSystem.IsLinux() ? "Linux" : "Unsupported"
            });
        }

        try
        {
            var result = await _wifiScanner.ScanAsync(request?.AdapterName, ct);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "network.wifi.scan",
                httpContext: HttpContext,
                success: result.Success,
                statusCode: 200,
                category: "network",
                message: result.Success 
                    ? $"WiFi scan: {result.Networks.Count} networks found"
                    : $"WiFi scan failed: {result.ErrorMessage}"));

            return Ok(result);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "WiFi scan failed");
            return StatusCode(500, new NetworkScanError
            {
                Code = "WIFI_SCAN_FAILED",
                Message = "WiFi scan operation failed",
                Details = ex.Message
            });
        }
    }

    #region Helper Methods

    private static bool TryValidateCidr(string cidr, out string? errorMessage)
    {
        errorMessage = null;

        var parts = cidr.Split('/');
        if (parts.Length != 2)
        {
            errorMessage = "CIDR must be in format IP/prefix (e.g., 192.168.1.0/24)";
            return false;
        }

        if (!IPAddress.TryParse(parts[0], out var ip))
        {
            errorMessage = $"Invalid IP address: {parts[0]}";
            return false;
        }

        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
        {
            errorMessage = "Only IPv4 addresses are supported";
            return false;
        }

        if (!int.TryParse(parts[1], out var prefix) || prefix < 16 || prefix > 30)
        {
            errorMessage = "Prefix length must be between 16 and 30 (e.g., /24 for 254 hosts)";
            return false;
        }

        return true;
    }

    private static bool IsPrivateNetwork(string cidr)
    {
        var ipPart = cidr.Split('/')[0];
        if (!IPAddress.TryParse(ipPart, out var ip))
        {
            return false;
        }

        var bytes = ip.GetAddressBytes();
        
        // 10.0.0.0/8
        if (bytes[0] == 10)
        {
            return true;
        }

        // 172.16.0.0/12
        if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31)
        {
            return true;
        }

        // 192.168.0.0/16
        if (bytes[0] == 192 && bytes[1] == 168)
        {
            return true;
        }

        // 127.0.0.0/8 (localhost)
        if (bytes[0] == 127)
        {
            return true;
        }

        // 169.254.0.0/16 (link-local)
        if (bytes[0] == 169 && bytes[1] == 254)
        {
            return true;
        }

        return false;
    }

    private static bool IsAllowedHostForPortScan(string host)
    {
        // Allow localhost
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
            host == "127.0.0.1" || host == "::1")
        {
            return true;
        }

        // For IP addresses, check if private
        if (IPAddress.TryParse(host, out var ip))
        {
            var bytes = ip.GetAddressBytes();
            
            // 10.0.0.0/8
            if (bytes[0] == 10) return true;
            
            // 172.16.0.0/12
            if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) return true;
            
            // 192.168.0.0/16
            if (bytes[0] == 192 && bytes[1] == 168) return true;
            
            // 127.0.0.0/8
            if (bytes[0] == 127) return true;
        }

        return false;
    }

    #endregion
}

#region Request Models

/// <summary>
/// Request for a ping operation.
/// </summary>
public record PingRequest
{
    /// <summary>
    /// Hostname or IP address to ping.
    /// </summary>
    public string Host { get; init; } = string.Empty;
    
    /// <summary>
    /// Timeout in milliseconds (default: 1000, max: 10000).
    /// </summary>
    public int? Timeout { get; init; }
}

/// <summary>
/// Request for a subnet scan operation.
/// </summary>
public record SubnetScanRequest
{
    /// <summary>
    /// CIDR notation of subnet to scan (e.g., 192.168.1.0/24).
    /// </summary>
    public string Cidr { get; init; } = string.Empty;
    
    /// <summary>
    /// Maximum concurrent pings (default: 100, max: 200).
    /// </summary>
    public int? ConcurrencyLimit { get; init; }
    
    /// <summary>
    /// Timeout per host in milliseconds (default: 500, max: 5000).
    /// </summary>
    public int? Timeout { get; init; }
}

/// <summary>
/// Request for a traceroute operation.
/// </summary>
public record TracerouteRequest
{
    /// <summary>
    /// Target hostname or IP address.
    /// </summary>
    public string Host { get; init; } = string.Empty;
    
    /// <summary>
    /// Maximum number of hops (default: 30, max: 64).
    /// </summary>
    public int? MaxHops { get; init; }
    
    /// <summary>
    /// Timeout per hop in milliseconds (default: 1000, max: 5000).
    /// </summary>
    public int? Timeout { get; init; }
}

/// <summary>
/// Request for a port scan operation.
/// </summary>
public record PortScanRequest
{
    /// <summary>
    /// Target hostname or IP address.
    /// </summary>
    public string Host { get; init; } = string.Empty;
    
    /// <summary>
    /// Specific ports to scan (null for common ports).
    /// </summary>
    public int[]? Ports { get; init; }
    
    /// <summary>
    /// Maximum concurrent connections (default: 50, max: 100).
    /// </summary>
    public int? Concurrency { get; init; }
    
    /// <summary>
    /// Timeout per port in milliseconds (default: 2000, max: 10000).
    /// </summary>
    public int? Timeout { get; init; }
}

/// <summary>
/// Request for combined mDNS/UPnP device discovery.
/// </summary>
public record DeviceDiscoveryRequest
{
    /// <summary>
    /// How long to scan for devices in seconds (default: 5, max: 30).
    /// </summary>
    public int? ScanDurationSeconds { get; init; }
}

/// <summary>
/// Request for mDNS device discovery.
/// </summary>
public record MdnsDiscoveryRequest
{
    /// <summary>
    /// How long to scan for devices in seconds (default: 5, max: 30).
    /// </summary>
    public int? ScanDurationSeconds { get; init; }
    
    /// <summary>
    /// Service types to search for (null for common types).
    /// Examples: "_http._tcp", "_ssh._tcp", "_printer._tcp"
    /// </summary>
    public string[]? ServiceTypes { get; init; }
}

/// <summary>
/// Request for UPnP/SSDP device discovery.
/// </summary>
public record UpnpDiscoveryRequest
{
    /// <summary>
    /// How long to scan for devices in seconds (default: 5, max: 30).
    /// </summary>
    public int? ScanDurationSeconds { get; init; }
    
    /// <summary>
    /// SSDP search target (default: "ssdp:all").
    /// Examples: "ssdp:all", "upnp:rootdevice", "urn:schemas-upnp-org:device:MediaRenderer:1"
    /// </summary>
    public string? SearchTarget { get; init; }
}

/// <summary>
/// Request for WiFi network scanning.
/// </summary>
public record WifiScanRequest
{
    /// <summary>
    /// Optional adapter name to use for scanning (null for first available).
    /// </summary>
    public string? AdapterName { get; init; }
}

#endregion

#region Helper Classes

/// <summary>
/// Comparer for sorting IP addresses numerically.
/// </summary>
file sealed class IpAddressComparer : IComparer<byte[]>
{
    public int Compare(byte[]? x, byte[]? y)
    {
        if (x is null && y is null) return 0;
        if (x is null) return -1;
        if (y is null) return 1;

        for (int i = 0; i < Math.Min(x.Length, y.Length); i++)
        {
            var cmp = x[i].CompareTo(y[i]);
            if (cmp != 0) return cmp;
        }

        return x.Length.CompareTo(y.Length);
    }
}

#endregion
