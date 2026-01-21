using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Network;
using Microsoft.AspNetCore.SignalR;

namespace ManLab.Server.Hubs;

/// <summary>
/// SignalR hub for real-time network scanning operations.
/// Provides progress updates for long-running scans like subnet discovery.
/// </summary>
public class NetworkHub : Hub
{
    private readonly ILogger<NetworkHub> _logger;
    private readonly INetworkScannerService _scanner;
    private readonly IDeviceDiscoveryService _discovery;
    private readonly IWifiScannerService _wifiScanner;
    private readonly IAuditLog _audit;

    public NetworkHub(
        ILogger<NetworkHub> logger,
        INetworkScannerService scanner,
        IDeviceDiscoveryService discovery,
        IWifiScannerService wifiScanner,
        IAuditLog audit)
    {
        _logger = logger;
        _scanner = scanner;
        _discovery = discovery;
        _wifiScanner = wifiScanner;
        _audit = audit;
    }

    /// <summary>
    /// Called when a client connects to the hub.
    /// </summary>
    public override Task OnConnectedAsync()
    {
        _logger.LogDebug("Client connected to NetworkHub: {ConnectionId}", Context.ConnectionId);
        return base.OnConnectedAsync();
    }

    /// <summary>
    /// Called when a client disconnects from the hub.
    /// </summary>
    public override Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogDebug("Client disconnected from NetworkHub: {ConnectionId}", Context.ConnectionId);
        return base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// Subscribes to updates for a specific scan operation.
    /// </summary>
    /// <param name="scanId">The scan operation ID.</param>
    public async Task SubscribeScan(string scanId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, GetScanGroup(scanId));
        _logger.LogDebug("Client {ConnectionId} subscribed to scan {ScanId}", Context.ConnectionId, scanId);
    }

    /// <summary>
    /// Unsubscribes from updates for a specific scan operation.
    /// </summary>
    /// <param name="scanId">The scan operation ID.</param>
    public async Task UnsubscribeScan(string scanId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GetScanGroup(scanId));
        _logger.LogDebug("Client {ConnectionId} unsubscribed from scan {ScanId}", Context.ConnectionId, scanId);
    }

    /// <summary>
    /// Performs a subnet scan with real-time progress updates.
    /// Clients should subscribe to the returned scanId to receive updates.
    /// </summary>
    /// <param name="cidr">CIDR notation (e.g., "192.168.1.0/24").</param>
    /// <param name="concurrencyLimit">Max concurrent pings.</param>
    /// <param name="timeout">Timeout per host in milliseconds.</param>
    /// <returns>The scan ID for subscribing to updates.</returns>
    public async Task<NetworkScanStartResult> StartSubnetScan(string cidr, int concurrencyLimit = 100, int timeout = 500)
    {
        var scanId = Guid.NewGuid().ToString("N");
        
        // Validate CIDR
        if (string.IsNullOrWhiteSpace(cidr))
        {
            return new NetworkScanStartResult
            {
                ScanId = scanId,
                Success = false,
                ErrorMessage = "CIDR notation is required"
            };
        }

        // Validate private network
        if (!IsPrivateNetwork(cidr))
        {
            return new NetworkScanStartResult
            {
                ScanId = scanId,
                Success = false,
                ErrorMessage = "Only private network ranges are allowed"
            };
        }

        // Get total hosts to scan
        int totalHosts;
        try
        {
            totalHosts = _scanner.ParseCidr(cidr).Count();
        }
        catch (ArgumentException ex)
        {
            return new NetworkScanStartResult
            {
                ScanId = scanId,
                Success = false,
                ErrorMessage = ex.Message
            };
        }

        _logger.LogInformation("Starting subnet scan {ScanId} for {Cidr} ({TotalHosts} hosts)", scanId, cidr, totalHosts);

        // Add the caller to the scan group automatically
        await Groups.AddToGroupAsync(Context.ConnectionId, GetScanGroup(scanId));

        // Notify scan started
        await Clients.Group(GetScanGroup(scanId)).SendAsync("ScanStarted", new ScanProgressUpdate
        {
            ScanId = scanId,
            Cidr = cidr,
            TotalHosts = totalHosts,
            ScannedHosts = 0,
            HostsFound = 0,
            Status = "started",
            StartedAt = DateTime.UtcNow
        });

        // Start the scan in background (don't await - let it run async)
        _ = RunSubnetScanAsync(scanId, cidr, totalHosts, concurrencyLimit, timeout);

        _audit.TryEnqueue(AuditEventFactory.CreateSignalR(
            kind: "activity",
            eventName: "network.scan.started",
            context: Context,
            hub: nameof(NetworkHub),
            hubMethod: nameof(StartSubnetScan),
            success: true,
            nodeId: null,
            category: "network",
            message: $"Subnet scan started: {cidr}"));

        return new NetworkScanStartResult
        {
            ScanId = scanId,
            Success = true,
            TotalHosts = totalHosts
        };
    }

    /// <summary>
    /// Performs a ping with progress callback.
    /// </summary>
    public async Task<PingResult> Ping(string host, int timeout = 1000)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            throw new HubException("Host is required");
        }

        timeout = Math.Clamp(timeout, 100, 10000);
        
        var result = await _scanner.PingAsync(host, timeout);
        
        // Broadcast result to all clients for real-time dashboard updates
        await Clients.All.SendAsync("PingCompleted", result);
        
        return result;
    }

    /// <summary>
    /// Performs a traceroute with real-time hop updates.
    /// </summary>
    public async Task<TracerouteResult> Traceroute(string host, int maxHops = 30, int timeout = 1000)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            throw new HubException("Host is required");
        }

        var scanId = Guid.NewGuid().ToString("N");
        await Groups.AddToGroupAsync(Context.ConnectionId, GetScanGroup(scanId));

        maxHops = Math.Clamp(maxHops, 1, 64);
        timeout = Math.Clamp(timeout, 100, 5000);

        _logger.LogInformation("Starting traceroute {ScanId} to {Host}", scanId, host);

        // Notify trace started
        await Clients.Group(GetScanGroup(scanId)).SendAsync("TracerouteStarted", new
        {
            ScanId = scanId,
            Host = host,
            MaxHops = maxHops
        });

        var result = await _scanner.TraceRouteAsync(host, maxHops, timeout);

        // Send each hop as it's discovered by replaying the result
        int hopIndex = 0;
        foreach (var hop in result.Hops)
        {
            hopIndex++;
            await Clients.Group(GetScanGroup(scanId)).SendAsync("TracerouteHop", new
            {
                ScanId = scanId,
                HopNumber = hopIndex,
                TotalHops = result.Hops.Count,
                Hop = hop,
                ReachedDestination = result.ReachedDestination && hopIndex == result.Hops.Count
            });
        }

        // Notify trace completed
        await Clients.Group(GetScanGroup(scanId)).SendAsync("TracerouteCompleted", result);

        return result;
    }

    /// <summary>
    /// Performs a port scan with real-time updates.
    /// </summary>
    public async Task<PortScanResult> ScanPorts(string host, int[]? ports = null, int concurrency = 50, int timeout = 2000)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            throw new HubException("Host is required");
        }

        // Validate host is private
        if (!IsAllowedHostForPortScan(host))
        {
            throw new HubException("Port scanning is only allowed for private network hosts");
        }

        var scanId = Guid.NewGuid().ToString("N");
        await Groups.AddToGroupAsync(Context.ConnectionId, GetScanGroup(scanId));

        concurrency = Math.Clamp(concurrency, 10, 100);
        timeout = Math.Clamp(timeout, 100, 10000);

        _logger.LogInformation("Starting port scan {ScanId} on {Host}", scanId, host);

        // Notify scan started
        var portsToScan = ports ?? GetCommonPorts();
        await Clients.Group(GetScanGroup(scanId)).SendAsync("PortScanStarted", new
        {
            ScanId = scanId,
            Host = host,
            TotalPorts = portsToScan.Length
        });

        var result = await _scanner.ScanPortsAsync(host, ports, concurrency, timeout);

        // Notify each open port found
        foreach (var port in result.OpenPorts)
        {
            await Clients.Group(GetScanGroup(scanId)).SendAsync("PortFound", new
            {
                ScanId = scanId,
                Port = port,
                ServiceName = GetServiceName(port)
            });
        }

        // Notify scan completed
        await Clients.Group(GetScanGroup(scanId)).SendAsync("PortScanCompleted", result);

        return result;
    }

    /// <summary>
    /// Performs mDNS/UPnP device discovery with real-time updates.
    /// </summary>
    public async Task<DiscoveryScanResult> DiscoverDevices(int scanDurationSeconds = 5)
    {
        var scanId = Guid.NewGuid().ToString("N");
        await Groups.AddToGroupAsync(Context.ConnectionId, GetScanGroup(scanId));

        scanDurationSeconds = Math.Clamp(scanDurationSeconds, 1, 30);

        _logger.LogInformation("Starting device discovery {ScanId} for {Duration}s", scanId, scanDurationSeconds);

        await Clients.Group(GetScanGroup(scanId)).SendAsync("DiscoveryStarted", new
        {
            ScanId = scanId,
            DurationSeconds = scanDurationSeconds
        });

        var result = await _discovery.DiscoverAllAsync(scanDurationSeconds);

        // Notify each device found
        foreach (var device in result.MdnsDevices)
        {
            await Clients.Group(GetScanGroup(scanId)).SendAsync("MdnsDeviceFound", new
            {
                ScanId = scanId,
                Device = device
            });
        }

        foreach (var device in result.UpnpDevices)
        {
            await Clients.Group(GetScanGroup(scanId)).SendAsync("UpnpDeviceFound", new
            {
                ScanId = scanId,
                Device = device
            });
        }

        await Clients.Group(GetScanGroup(scanId)).SendAsync("DiscoveryCompleted", result);

        return result;
    }

    /// <summary>
    /// Performs WiFi scan with real-time updates.
    /// </summary>
    public async Task<WifiScanResult> ScanWifi(string? adapterName = null)
    {
        var scanId = Guid.NewGuid().ToString("N");
        await Groups.AddToGroupAsync(Context.ConnectionId, GetScanGroup(scanId));

        if (!_wifiScanner.IsSupported)
        {
            var unsupportedResult = new WifiScanResult
            {
                StartedAt = DateTime.UtcNow,
                CompletedAt = DateTime.UtcNow,
                Success = false,
                ErrorMessage = "WiFi scanning is not supported on this platform"
            };
            
            await Clients.Group(GetScanGroup(scanId)).SendAsync("WifiScanCompleted", unsupportedResult);
            return unsupportedResult;
        }

        _logger.LogInformation("Starting WiFi scan {ScanId}", scanId);

        await Clients.Group(GetScanGroup(scanId)).SendAsync("WifiScanStarted", new
        {
            ScanId = scanId,
            AdapterName = adapterName
        });

        var result = await _wifiScanner.ScanAsync(adapterName);

        // Notify each network found
        foreach (var network in result.Networks)
        {
            await Clients.Group(GetScanGroup(scanId)).SendAsync("WifiNetworkFound", new
            {
                ScanId = scanId,
                Network = network
            });
        }

        await Clients.Group(GetScanGroup(scanId)).SendAsync("WifiScanCompleted", result);

        return result;
    }

    #region Private Methods

    private async Task RunSubnetScanAsync(string scanId, string cidr, int totalHosts, int concurrencyLimit, int timeout)
    {
        var startedAt = DateTime.UtcNow;
        var scannedCount = 0;
        var foundHosts = new List<DiscoveredHost>();
        var lastProgressUpdate = DateTime.UtcNow;

        try
        {
            await foreach (var host in _scanner.ScanSubnetAsync(cidr, concurrencyLimit, timeout))
            {
                foundHosts.Add(host);
                scannedCount++;

                // Send host found event
                await Clients.Group(GetScanGroup(scanId)).SendAsync("HostFound", new
                {
                    ScanId = scanId,
                    Host = host
                });

                // Send progress updates every 500ms or every 10 hosts
                if ((DateTime.UtcNow - lastProgressUpdate).TotalMilliseconds >= 500 || scannedCount % 10 == 0)
                {
                    await Clients.Group(GetScanGroup(scanId)).SendAsync("ScanProgress", new ScanProgressUpdate
                    {
                        ScanId = scanId,
                        Cidr = cidr,
                        TotalHosts = totalHosts,
                        ScannedHosts = scannedCount,
                        HostsFound = foundHosts.Count,
                        Status = "scanning",
                        StartedAt = startedAt
                    });
                    lastProgressUpdate = DateTime.UtcNow;
                }
            }

            // Estimate scanned count for completed scan (we streamed discovered hosts, not all attempts)
            // In a streaming scan, we don't track failed pings - estimate based on timing
            var estimatedScanned = totalHosts;

            // Send completion event
            await Clients.Group(GetScanGroup(scanId)).SendAsync("ScanCompleted", new
            {
                ScanId = scanId,
                Cidr = cidr,
                TotalHosts = totalHosts,
                HostsFound = foundHosts.Count,
                Hosts = foundHosts,
                StartedAt = startedAt,
                CompletedAt = DateTime.UtcNow
            });

            _logger.LogInformation("Subnet scan {ScanId} completed: {HostsFound}/{TotalHosts} hosts found", 
                scanId, foundHosts.Count, totalHosts);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Subnet scan {ScanId} failed", scanId);

            await Clients.Group(GetScanGroup(scanId)).SendAsync("ScanFailed", new
            {
                ScanId = scanId,
                Cidr = cidr,
                Error = ex.Message
            });
        }
    }

    private static string GetScanGroup(string scanId) => $"network-scan.{scanId}";

    private static bool IsPrivateNetwork(string cidr)
    {
        var ipPart = cidr.Split('/')[0];
        if (!System.Net.IPAddress.TryParse(ipPart, out var ip))
        {
            return false;
        }

        var bytes = ip.GetAddressBytes();
        
        // 10.0.0.0/8
        if (bytes[0] == 10) return true;
        
        // 172.16.0.0/12
        if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) return true;
        
        // 192.168.0.0/16
        if (bytes[0] == 192 && bytes[1] == 168) return true;
        
        // 127.0.0.0/8
        if (bytes[0] == 127) return true;
        
        // 169.254.0.0/16 (link-local)
        if (bytes[0] == 169 && bytes[1] == 254) return true;

        return false;
    }

    private static bool IsAllowedHostForPortScan(string host)
    {
        if (host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
            host == "127.0.0.1" || host == "::1")
        {
            return true;
        }

        if (System.Net.IPAddress.TryParse(host, out var ip))
        {
            var bytes = ip.GetAddressBytes();
            
            if (bytes[0] == 10) return true;
            if (bytes[0] == 172 && bytes[1] >= 16 && bytes[1] <= 31) return true;
            if (bytes[0] == 192 && bytes[1] == 168) return true;
            if (bytes[0] == 127) return true;
        }

        return false;
    }

    private static int[] GetCommonPorts()
    {
        return [21, 22, 23, 25, 53, 80, 110, 143, 443, 445, 993, 995, 
                3306, 3389, 5432, 5900, 6379, 8080, 8443, 27017];
    }

    private static string GetServiceName(int port)
    {
        return port switch
        {
            20 => "FTP-Data",
            21 => "FTP",
            22 => "SSH",
            23 => "Telnet",
            25 => "SMTP",
            53 => "DNS",
            67 => "DHCP",
            68 => "DHCP",
            80 => "HTTP",
            110 => "POP3",
            123 => "NTP",
            143 => "IMAP",
            161 => "SNMP",
            162 => "SNMP-Trap",
            443 => "HTTPS",
            445 => "SMB",
            465 => "SMTPS",
            514 => "Syslog",
            587 => "SMTP",
            636 => "LDAPS",
            993 => "IMAPS",
            995 => "POP3S",
            1433 => "MSSQL",
            1521 => "Oracle",
            3306 => "MySQL",
            3389 => "RDP",
            5432 => "PostgreSQL",
            5900 => "VNC",
            5901 => "VNC",
            6379 => "Redis",
            8080 => "HTTP-Alt",
            8443 => "HTTPS-Alt",
            9200 => "Elasticsearch",
            27017 => "MongoDB",
            _ => $"Port-{port}"
        };
    }

    #endregion
}

#region DTOs

/// <summary>
/// Result of starting a network scan operation.
/// </summary>
public record NetworkScanStartResult
{
    /// <summary>
    /// The scan operation ID (use to subscribe for updates).
    /// </summary>
    public required string ScanId { get; init; }
    
    /// <summary>
    /// Whether the scan was started successfully.
    /// </summary>
    public bool Success { get; init; }
    
    /// <summary>
    /// Error message if the scan failed to start.
    /// </summary>
    public string? ErrorMessage { get; init; }
    
    /// <summary>
    /// Total number of hosts to be scanned.
    /// </summary>
    public int TotalHosts { get; init; }
}

/// <summary>
/// Progress update during a scan operation.
/// </summary>
public record ScanProgressUpdate
{
    /// <summary>
    /// The scan operation ID.
    /// </summary>
    public required string ScanId { get; init; }
    
    /// <summary>
    /// The CIDR being scanned.
    /// </summary>
    public string? Cidr { get; init; }
    
    /// <summary>
    /// Total hosts to scan.
    /// </summary>
    public int TotalHosts { get; init; }
    
    /// <summary>
    /// Number of hosts scanned so far.
    /// </summary>
    public int ScannedHosts { get; init; }
    
    /// <summary>
    /// Number of responsive hosts found.
    /// </summary>
    public int HostsFound { get; init; }
    
    /// <summary>
    /// Current status (started, scanning, completed, failed).
    /// </summary>
    public required string Status { get; init; }
    
    /// <summary>
    /// When the scan started.
    /// </summary>
    public DateTime StartedAt { get; init; }
    
    /// <summary>
    /// Estimated percentage complete.
    /// </summary>
    public int PercentComplete => TotalHosts > 0 ? (ScannedHosts * 100) / TotalHosts : 0;
}

#endregion
