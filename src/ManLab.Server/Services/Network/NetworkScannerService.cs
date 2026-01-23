using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using System.Threading.Channels;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Implementation of network scanning service using native .NET libraries.
/// </summary>
public sealed class NetworkScannerService : INetworkScannerService
{
    private readonly ILogger<NetworkScannerService> _logger;
    private readonly IArpService? _arpService;
    private readonly IOuiDatabase? _ouiDatabase;

    /// <summary>
    /// Common ports to scan when no specific ports are provided.
    /// </summary>
    private static readonly int[] CommonPorts =
    [
        21,   // FTP
        22,   // SSH
        23,   // Telnet
        25,   // SMTP
        53,   // DNS
        80,   // HTTP
        110,  // POP3
        135,  // Windows RPC
        139,  // NetBIOS
        143,  // IMAP
        443,  // HTTPS
        445,  // SMB
        993,  // IMAPS
        995,  // POP3S
        1433, // MSSQL
        3306, // MySQL
        3389, // RDP
        5432, // PostgreSQL
        5900, // VNC
        8080  // HTTP Alt
    ];

    public NetworkScannerService(
        ILogger<NetworkScannerService> logger,
        IArpService? arpService = null,
        IOuiDatabase? ouiDatabase = null)
    {
        _logger = logger;
        _arpService = arpService;
        _ouiDatabase = ouiDatabase;
    }

    /// <inheritdoc />
    public async Task<PingResult> PingAsync(string host, int timeout = 1000, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            throw new ArgumentException("Host cannot be null or empty", nameof(host));
        }

        try
        {
            using var ping = new Ping();
            var reply = await ping.SendPingAsync(host, timeout);
            
            return new PingResult
            {
                Address = host,
                ResolvedAddress = reply.Address?.ToString(),
                Status = reply.Status,
                RoundtripTime = reply.RoundtripTime,
                Ttl = reply.Options?.Ttl
            };
        }
        catch (PingException ex)
        {
            _logger.LogWarning(ex, "Ping failed for host {Host}", host);
            return new PingResult
            {
                Address = host,
                Status = IPStatus.Unknown,
                RoundtripTime = 0
            };
        }
    }

    /// <inheritdoc />
    public async IAsyncEnumerable<DiscoveredHost> ScanSubnetAsync(
        string cidr,
        int concurrencyLimit = 100,
        int timeout = 500,
        [EnumeratorCancellation] CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(cidr))
        {
            throw new ArgumentException("CIDR cannot be null or empty", nameof(cidr));
        }

        var ipRange = ParseCidr(cidr).ToList();
        var semaphore = new SemaphoreSlim(Math.Min(concurrencyLimit, 256));
        var channel = Channel.CreateUnbounded<DiscoveredHost>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });

        _logger.LogInformation("Starting subnet scan of {Cidr} ({Count} addresses)", cidr, ipRange.Count);

        // Start scanning in background
        var scanTask = Task.Run(async () =>
        {
            try
            {
                var tasks = new List<Task>();
                
                foreach (var ip in ipRange)
                {
                    if (ct.IsCancellationRequested) break;
                    
                    await semaphore.WaitAsync(ct);
                    
                    var task = Task.Run(async () =>
                    {
                        try
                        {
                            using var ping = new Ping();
                            var reply = await ping.SendPingAsync(ip, timeout);
                            
                            if (reply.Status == IPStatus.Success)
                            {
                                var host = new DiscoveredHost
                                {
                                    IpAddress = ip.ToString(),
                                    RoundtripTime = reply.RoundtripTime,
                                    DiscoveredAt = DateTime.UtcNow
                                };

                                // Try to resolve hostname (best effort)
                                try
                                {
                                    var hostEntry = await Dns.GetHostEntryAsync(ip);
                                    host = host with { Hostname = hostEntry.HostName };
                                }
                                catch (SocketException) { /* No DNS entry */ }

                                // MAC Address + Vendor (best effort)
                                if (_arpService is not null)
                                {
                                    try
                                    {
                                        var mac = await _arpService.GetMacAddressAsync(ip, ct);
                                        if (mac is not null)
                                        {
                                            host = host with { MacAddress = mac };

                                            if (_ouiDatabase is not null)
                                            {
                                                var vendor = _ouiDatabase.LookupVendor(mac);
                                                host = host with { Vendor = vendor };
                                            }
                                        }
                                    }
                                    catch (Exception ex)
                                    {
                                        _logger.LogDebug(ex, "Failed to get MAC/vendor for {IP}", ip);
                                    }
                                }

                                // Device type inference (best effort)
                                var deviceType = InferDeviceType(host.Vendor, host.Hostname);
                                if (!string.IsNullOrWhiteSpace(deviceType))
                                {
                                    host = host with { DeviceType = deviceType };
                                }

                                await channel.Writer.WriteAsync(host, ct);
                            }
                        }
                        catch (Exception ex) when (ex is not OperationCanceledException)
                        {
                            _logger.LogDebug(ex, "Error pinging {IP}", ip);
                        }
                        finally
                        {
                            semaphore.Release();
                        }
                    }, ct);
                    
                    tasks.Add(task);
                }

                await Task.WhenAll(tasks);
            }
            catch (OperationCanceledException)
            {
                _logger.LogInformation("Subnet scan of {Cidr} was cancelled", cidr);
            }
            finally
            {
                channel.Writer.Complete();
            }
        }, ct);

        await foreach (var host in channel.Reader.ReadAllAsync(ct))
        {
            yield return host;
        }
        
        await scanTask;
        
        _logger.LogInformation("Subnet scan of {Cidr} completed", cidr);
    }

    /// <inheritdoc />
    public async Task<TracerouteResult> TraceRouteAsync(
        string hostname,
        int maxHops = 30,
        int timeout = 1000,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(hostname))
        {
            throw new ArgumentException("Hostname cannot be null or empty", nameof(hostname));
        }

        var stopwatch = Stopwatch.StartNew();
        var hops = new List<TracerouteHop>();
        var buffer = new byte[32];
        string? resolvedAddress = null;

        // Resolve hostname first
        try
        {
            var addresses = await Dns.GetHostAddressesAsync(hostname, ct);
            if (addresses.Length > 0)
            {
                resolvedAddress = addresses[0].ToString();
            }
        }
        catch (SocketException)
        {
            // Continue with hostname as-is
        }

        _logger.LogInformation("Starting traceroute to {Hostname}", hostname);

        using var ping = new Ping();

        for (int ttl = 1; ttl <= maxHops; ttl++)
        {
            ct.ThrowIfCancellationRequested();

            var options = new PingOptions(ttl, dontFragment: true);
            
            try
            {
                var reply = await ping.SendPingAsync(hostname, timeout, buffer, options);
                
                string? hopHostname = null;
                if (reply.Address is not null && !IsUnspecifiedAddress(reply.Address))
                {
                    try
                    {
                        var hostEntry = await Dns.GetHostEntryAsync(reply.Address);
                        hopHostname = hostEntry.HostName;
                    }
                    catch (SocketException) { /* No reverse DNS */ }
                    catch (ArgumentException) { /* Unspecified/invalid address */ }
                }

                var hop = new TracerouteHop
                {
                    HopNumber = ttl,
                    Address = reply.Address?.ToString(),
                    Hostname = hopHostname,
                    RoundtripTime = reply.RoundtripTime,
                    Status = reply.Status
                };
                hops.Add(hop);

                // Destination reached
                if (reply.Status == IPStatus.Success)
                {
                    _logger.LogInformation("Traceroute to {Hostname} completed in {Hops} hops", hostname, ttl);
                    break;
                }

                // Continue only on TtlExpired or TimedOut
                if (reply.Status != IPStatus.TtlExpired && reply.Status != IPStatus.TimedOut)
                {
                    _logger.LogWarning("Traceroute to {Hostname} stopped at hop {Hop} with status {Status}", 
                        hostname, ttl, reply.Status);
                    break;
                }
            }
            catch (PingException ex)
            {
                _logger.LogDebug(ex, "Ping exception at hop {Hop}", ttl);
                hops.Add(new TracerouteHop
                {
                    HopNumber = ttl,
                    Status = IPStatus.Unknown
                });
            }
        }

        stopwatch.Stop();

        return new TracerouteResult
        {
            Hostname = hostname,
            ResolvedAddress = resolvedAddress,
            Hops = hops,
            MaxHops = maxHops,
            DurationMs = stopwatch.ElapsedMilliseconds
        };
    }

    /// <inheritdoc />
    public async Task<PortScanResult> ScanPortsAsync(
        string host,
        int[]? ports = null,
        int concurrency = 50,
        int timeout = 2000,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            throw new ArgumentException("Host cannot be null or empty", nameof(host));
        }

        ports ??= CommonPorts;
        var openPorts = new ConcurrentBag<int>();
        var semaphore = new SemaphoreSlim(Math.Min(concurrency, 200));
        var stopwatch = Stopwatch.StartNew();

        _logger.LogInformation("Starting port scan of {Host} ({Count} ports)", host, ports.Length);

        await Parallel.ForEachAsync(ports, ct, async (port, token) =>
        {
            await semaphore.WaitAsync(token);
            try
            {
                using var socket = new Socket(AddressFamily.InterNetwork, SocketType.Stream, ProtocolType.Tcp);
                using var cts = CancellationTokenSource.CreateLinkedTokenSource(token);
                cts.CancelAfter(timeout);

                try
                {
                    await socket.ConnectAsync(host, port, cts.Token);
                    openPorts.Add(port);
                    _logger.LogDebug("Port {Port} is open on {Host}", port, host);
                }
                catch (OperationCanceledException) { /* Timeout */ }
                catch (SocketException) { /* Closed/filtered */ }
            }
            finally
            {
                semaphore.Release();
            }
        });

        stopwatch.Stop();

        var result = new PortScanResult
        {
            Host = host,
            OpenPorts = openPorts.OrderBy(p => p).ToList(),
            ScannedPorts = ports.Length,
            DurationMs = stopwatch.ElapsedMilliseconds
        };

        _logger.LogInformation("Port scan of {Host} completed: {OpenCount} open ports found in {Duration}ms", 
            host, result.OpenPorts.Count, result.DurationMs);

        return result;
    }

    /// <inheritdoc />
    public async Task<DeviceInfo> GetDeviceInfoAsync(string ip, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(ip))
        {
            throw new ArgumentException("IP address cannot be null or empty", nameof(ip));
        }

        var info = new DeviceInfo { IpAddress = ip };
        
        // Hostname (best effort)
        try
        {
            var hostEntry = await Dns.GetHostEntryAsync(ip, ct);
            info = info with { Hostname = hostEntry.HostName };
        }
        catch (SocketException) { /* No DNS entry */ }

        // Ping for response time
        try
        {
            var pingResult = await PingAsync(ip, ct: ct);
            if (pingResult.IsSuccess)
            {
                info = info with { ResponseTimeMs = pingResult.RoundtripTime };
            }
        }
        catch { /* Ignore ping failures */ }

        // MAC Address (if ARP service available)
        if (_arpService is not null)
        {
            try
            {
                var mac = await _arpService.GetMacAddressAsync(IPAddress.Parse(ip), ct);
                if (mac is not null)
                {
                    info = info with { MacAddress = mac };
                    
                    // Vendor lookup
                    if (_ouiDatabase is not null)
                    {
                        var vendor = _ouiDatabase.LookupVendor(mac);
                        info = info with { Vendor = vendor };
                    }
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to get MAC address for {IP}", ip);
            }
        }

        var inferredType = InferDeviceType(info.Vendor, info.Hostname);
        if (!string.IsNullOrWhiteSpace(inferredType))
        {
            info = info with { DeviceType = inferredType };
        }

        return info;
    }

    /// <inheritdoc />
    public IEnumerable<IPAddress> ParseCidr(string cidr)
    {
        if (string.IsNullOrWhiteSpace(cidr))
        {
            throw new ArgumentException("CIDR cannot be null or empty", nameof(cidr));
        }

        var parts = cidr.Split('/');
        if (parts.Length != 2)
        {
            throw new ArgumentException($"Invalid CIDR notation: {cidr}", nameof(cidr));
        }

        if (!IPAddress.TryParse(parts[0], out var baseAddress))
        {
            throw new ArgumentException($"Invalid IP address in CIDR: {parts[0]}", nameof(cidr));
        }

        if (!int.TryParse(parts[1], out var prefixLength) || prefixLength < 0 || prefixLength > 32)
        {
            throw new ArgumentException($"Invalid prefix length in CIDR: {parts[1]}", nameof(cidr));
        }

        // For IPv4 only
        if (baseAddress.AddressFamily != AddressFamily.InterNetwork)
        {
            throw new ArgumentException("Only IPv4 addresses are supported", nameof(cidr));
        }

        // Calculate the number of hosts
        var hostBits = 32 - prefixLength;
        var hostCount = (long)Math.Pow(2, hostBits);

        // Limit to prevent OOM for large ranges
        const int MaxHosts = 65536; // /16 subnet max
        if (hostCount > MaxHosts)
        {
            throw new ArgumentException($"CIDR range too large: {hostCount} hosts. Maximum allowed: {MaxHosts}", nameof(cidr));
        }

        // Convert base address to uint32
        var addressBytes = baseAddress.GetAddressBytes();
        Array.Reverse(addressBytes); // Convert to host byte order
        var baseIp = BitConverter.ToUInt32(addressBytes, 0);

        // Apply network mask
        var mask = prefixLength == 0 ? 0 : uint.MaxValue << hostBits;
        var networkIp = baseIp & mask;

        // Generate all IPs in range (skip network and broadcast for /24 and smaller)
        var startOffset = prefixLength >= 24 ? 1 : 0;
        var endOffset = prefixLength >= 24 ? hostCount - 1 : hostCount;

        for (long i = startOffset; i < endOffset; i++)
        {
            var ip = networkIp + (uint)i;
            var ipBytes = BitConverter.GetBytes(ip);
            Array.Reverse(ipBytes); // Convert back to network byte order
            yield return new IPAddress(ipBytes);
        }
    }

    private static string? InferDeviceType(string? vendor, string? hostname)
    {
        static bool Contains(string? value, string token)
            => value?.Contains(token, StringComparison.OrdinalIgnoreCase) == true;

        if (Contains(vendor, "raspberry") || Contains(hostname, "raspberry") || Contains(hostname, "raspberrypi"))
            return "Raspberry Pi";

        if (Contains(vendor, "apple") || Contains(hostname, "iphone") || Contains(hostname, "ipad") ||
            Contains(hostname, "mac") || Contains(hostname, "apple"))
            return "Apple";

        if (Contains(vendor, "samsung") || Contains(hostname, "samsung") || Contains(hostname, "galaxy"))
            return "Samsung";

        if (Contains(vendor, "tuya") || Contains(vendor, "espressif") || Contains(vendor, "sonoff") ||
            Contains(vendor, "shelly") || Contains(vendor, "aqara") || Contains(vendor, "xiaomi") ||
            Contains(vendor, "hue") || Contains(vendor, "philips") || Contains(hostname, "iot"))
            return "IoT";

        if (Contains(vendor, "tp-link") || Contains(vendor, "tplink") || Contains(vendor, "netgear") ||
            Contains(vendor, "linksys") || Contains(vendor, "cisco") || Contains(vendor, "mikrotik") ||
            Contains(vendor, "ubiquiti") || Contains(vendor, "asus") || Contains(hostname, "router") ||
            Contains(hostname, "gateway"))
            return "Router";

        if (Contains(vendor, "printer") || Contains(vendor, "hp") || Contains(vendor, "hewlett") ||
            Contains(vendor, "epson") || Contains(vendor, "brother") || Contains(vendor, "canon") ||
            Contains(hostname, "printer"))
            return "Printer";

        if (Contains(vendor, "camera") || Contains(vendor, "hikvision") || Contains(vendor, "dahua") ||
            Contains(hostname, "camera"))
            return "Camera";

        if (Contains(vendor, "tv") || Contains(vendor, "television") || Contains(vendor, "roku") ||
            Contains(vendor, "chromecast") || Contains(vendor, "firetv") || Contains(vendor, "lg") ||
            Contains(hostname, "tv") || Contains(hostname, "television"))
            return "TV";

        if (Contains(vendor, "speaker") || Contains(vendor, "sonos") || Contains(hostname, "speaker"))
            return "Speaker";

        if (Contains(vendor, "synology") || Contains(vendor, "qnap") || Contains(vendor, "server") ||
            Contains(hostname, "server") || Contains(hostname, "nas"))
            return "Server";

        if (Contains(hostname, "laptop") || Contains(hostname, "desktop") || Contains(hostname, "pc") ||
            Contains(hostname, "windows") || Contains(hostname, "macbook") || Contains(hostname, "imac"))
            return "Computer";

        if (Contains(hostname, "phone") || Contains(hostname, "android") || Contains(hostname, "iphone"))
            return "Phone";

        return null;
    }

    private static bool IsUnspecifiedAddress(IPAddress address)
        => address.Equals(IPAddress.Any) || address.Equals(IPAddress.IPv6Any);
}
