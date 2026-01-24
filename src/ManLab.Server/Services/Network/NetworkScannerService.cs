using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Security;
using System.Net.NetworkInformation;
using System.Net.Http.Headers;
using System.Net.Sockets;
using System.Runtime.CompilerServices;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using DnsClient;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Implementation of network scanning service using native .NET libraries.
/// </summary>
public sealed class NetworkScannerService : INetworkScannerService
{
    private readonly ILogger<NetworkScannerService> _logger;
    private readonly IArpService? _arpService;
    private readonly IOuiDatabase? _ouiDatabase;
    private readonly LookupClient _dnsClient;
    private readonly HttpClient _httpClient;

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
        IHttpClientFactory httpClientFactory,
        IArpService? arpService = null,
        IOuiDatabase? ouiDatabase = null)
    {
        _logger = logger;
        _arpService = arpService;
        _ouiDatabase = ouiDatabase;
        _httpClient = httpClientFactory.CreateClient();
        _httpClient.Timeout = TimeSpan.FromSeconds(5);
        _dnsClient = new LookupClient(new LookupClientOptions
        {
            UseCache = true,
            Timeout = TimeSpan.FromSeconds(5),
            Retries = 1
        });
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
        CancellationToken ct = default,
        Func<TracerouteHop, int, Task>? onHop = null)
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
                var pingSw = Stopwatch.StartNew();
                var reply = await ping.SendPingAsync(hostname, timeout, buffer, options);
                pingSw.Stop();
                
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

                var rtt = reply.RoundtripTime;
                if (rtt == 0 && (reply.Status == IPStatus.Success || reply.Status == IPStatus.TtlExpired))
                {
                    // Fallback to stopwatch if Ping reports 0ms but was successful
                    // This often happens on fast networks or Windows TtlExpired
                    rtt = pingSw.ElapsedMilliseconds;
                    if (rtt == 0) rtt = 1; // Ensure at least 1ms if successful
                }

                var hop = new TracerouteHop
                {
                    HopNumber = ttl,
                    Address = reply.Address?.ToString(),
                    Hostname = hopHostname,
                    RoundtripTime = rtt,
                    Status = reply.Status
                };
                hops.Add(hop);

                if (onHop is not null)
                {
                    await onHop(hop, ttl);
                }

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
                var hop = new TracerouteHop
                {
                    HopNumber = ttl,
                    Status = IPStatus.Unknown
                };
                hops.Add(hop);

                if (onHop is not null)
                {
                    await onHop(hop, ttl);
                }
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
    public async Task<DnsLookupResult> DnsLookupAsync(string query, bool includeReverse = true, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            throw new ArgumentException("Query cannot be null or empty", nameof(query));
        }

        var records = new List<DnsRecord>();
        var reverseRecords = new List<DnsRecord>();
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        var types = new[]
        {
            QueryType.A,
            QueryType.AAAA,
            QueryType.CNAME,
            QueryType.MX,
            QueryType.TXT,
            QueryType.NS,
            QueryType.SOA
        };

        foreach (var type in types)
        {
            ct.ThrowIfCancellationRequested();
            try
            {
                var response = await _dnsClient.QueryAsync(query, type, cancellationToken: ct);
                foreach (var record in MapDnsRecords(type, response))
                {
                    if (seen.Add($"{record.Type}:{record.Name}:{record.Value}:{record.Priority}"))
                    {
                        records.Add(record);
                    }
                }
            }
            catch (DnsResponseException ex)
            {
                _logger.LogDebug(ex, "DNS lookup {Type} failed for {Query}", type, query);
            }
        }

        if (includeReverse)
        {
            var ips = new List<IPAddress>();
            if (IPAddress.TryParse(query, out var parsedIp))
            {
                ips.Add(parsedIp);
            }
            else
            {
                ips.AddRange(records
                    .Where(r => r.Type is DnsRecordType.A or DnsRecordType.AAAA)
                    .Select(r => IPAddress.TryParse(r.Value, out var ip) ? ip : null)
                    .Where(ip => ip is not null)!
                    .Select(ip => ip!));
            }

            foreach (var ip in ips.Distinct())
            {
                ct.ThrowIfCancellationRequested();
                try
                {
                    var response = await _dnsClient.QueryReverseAsync(ip, ct);
                    foreach (var ptr in response.Answers.PtrRecords())
                    {
                        reverseRecords.Add(new DnsRecord
                        {
                            Name = ptr.DomainName.Value,
                            Type = DnsRecordType.PTR,
                            Value = ptr.PtrDomainName.Value,
                            Ttl = (int?)ptr.TimeToLive
                        });
                    }
                }
                catch (DnsResponseException ex)
                {
                    _logger.LogDebug(ex, "Reverse DNS lookup failed for {Ip}", ip);
                }
            }
        }

        return new DnsLookupResult
        {
            Query = query,
            Records = records.OrderBy(r => r.Type).ThenBy(r => r.Name).ToList(),
            ReverseRecords = reverseRecords.OrderBy(r => r.Name).ToList()
        };
    }

    /// <inheritdoc />
    public async Task<WhoisResult> WhoisAsync(string query, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            throw new ArgumentException("Query cannot be null or empty", nameof(query));
        }

        const string ianaServer = "whois.iana.org";
        var initialResponse = await QueryWhoisServerAsync(ianaServer, query, ct);
        var referral = TryParseWhoisReferral(initialResponse);

        if (!string.IsNullOrWhiteSpace(referral))
        {
            var referralResponse = await QueryWhoisServerAsync(referral, query, ct);
            return new WhoisResult
            {
                Query = query,
                Server = referral,
                Response = referralResponse
            };
        }

        return new WhoisResult
        {
            Query = query,
            Server = ianaServer,
            Response = initialResponse
        };
    }

    /// <inheritdoc />
    public async Task<WolSendResult> SendWakeOnLanAsync(
        string macAddress,
        string? broadcastAddress = null,
        int port = 9,
        CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(macAddress))
        {
            throw new ArgumentException("MAC address is required", nameof(macAddress));
        }

        if (!TryParseMacAddress(macAddress, out var macBytes))
        {
            throw new ArgumentException("Invalid MAC address format", nameof(macAddress));
        }

        var broadcast = broadcastAddress ?? "255.255.255.255";
        if (!IPAddress.TryParse(broadcast, out var broadcastIp))
        {
            throw new ArgumentException("Invalid broadcast address", nameof(broadcastAddress));
        }

        var packet = BuildMagicPacket(macBytes);
        var formattedMac = string.Join(":", macBytes.Select(b => b.ToString("X2")));

        try
        {
            using var udp = new UdpClient();
            udp.EnableBroadcast = true;
            ct.ThrowIfCancellationRequested();
            await udp.SendAsync(packet, packet.Length, broadcastIp.ToString(), port).WaitAsync(ct);

            return new WolSendResult
            {
                MacAddress = formattedMac,
                BroadcastAddress = broadcastIp.ToString(),
                Port = port,
                Success = true
            };
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Failed to send WoL packet to {Mac}", formattedMac);
            return new WolSendResult
            {
                MacAddress = formattedMac,
                BroadcastAddress = broadcastIp.ToString(),
                Port = port,
                Success = false,
                Error = ex.Message
            };
        }
    }

    /// <inheritdoc />
    public async Task<SslInspectionResult> InspectCertificateAsync(string host, int port = 443, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(host))
        {
            throw new ArgumentException("Host is required", nameof(host));
        }

        using var tcpClient = new TcpClient();
        await tcpClient.ConnectAsync(host, port, ct);

        await using var sslStream = new SslStream(
            tcpClient.GetStream(),
            leaveInnerStreamOpen: false,
            userCertificateValidationCallback: (_, _, _, _) => true);

        await sslStream.AuthenticateAsClientAsync(new SslClientAuthenticationOptions
        {
            TargetHost = host,
            CertificateRevocationCheckMode = X509RevocationMode.NoCheck
        }, ct);

        if (sslStream.RemoteCertificate is null)
        {
            throw new InvalidOperationException("No certificate returned by remote host.");
        }

        var leafCertificate = new X509Certificate2(sslStream.RemoteCertificate);
        using var chain = new X509Chain();
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.Build(leafCertificate);

        var chainInfos = chain.ChainElements
            .Cast<X509ChainElement>()
            .Select(element => ToCertificateInfo(element.Certificate))
            .ToList();

        var daysRemaining = (int)Math.Floor((leafCertificate.NotAfter.ToUniversalTime() - DateTime.UtcNow).TotalDays);

        return new SslInspectionResult
        {
            Host = host,
            Port = port,
            RetrievedAt = DateTime.UtcNow,
            Chain = chainInfos,
            DaysRemaining = daysRemaining,
            IsValidNow = DateTime.UtcNow >= leafCertificate.NotBefore.ToUniversalTime()
                         && DateTime.UtcNow <= leafCertificate.NotAfter.ToUniversalTime()
        };
    }

    /// <inheritdoc />
    public async Task<PublicIpResult> GetPublicIpAsync(CancellationToken ct = default)
    {
        var retrievedAt = DateTime.UtcNow;

        var (ipv4, ipv4Provider) = await TryResolvePublicIpAsync(
            new[]
            {
                new PublicIpEndpoint("ipify", new Uri("https://api.ipify.org?format=json")),
                new PublicIpEndpoint("ifconfig", new Uri("https://ifconfig.co/json"))
            },
            ct).ConfigureAwait(false);

        var (ipv6, ipv6Provider) = await TryResolvePublicIpAsync(
            new[]
            {
                new PublicIpEndpoint("ipify", new Uri("https://api64.ipify.org?format=json")),
                new PublicIpEndpoint("ifconfig", new Uri("https://ifconfig.co/json"))
            },
            ct).ConfigureAwait(false);

        if (string.IsNullOrWhiteSpace(ipv4) && string.IsNullOrWhiteSpace(ipv6))
        {
            throw new InvalidOperationException("Unable to determine public IP address.");
        }

        return new PublicIpResult
        {
            Ipv4 = ipv4,
            Ipv4Provider = ipv4Provider,
            Ipv6 = ipv6,
            Ipv6Provider = ipv6Provider,
            RetrievedAt = retrievedAt
        };
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

    private static IEnumerable<DnsRecord> MapDnsRecords(QueryType type, IDnsQueryResponse response)
    {
        switch (type)
        {
            case QueryType.A:
                return response.Answers.ARecords().Select(a => new DnsRecord
                {
                    Name = a.DomainName.Value,
                    Type = DnsRecordType.A,
                    Value = a.Address.ToString(),
                    Ttl = (int?)a.TimeToLive
                });
            case QueryType.AAAA:
                return response.Answers.AaaaRecords().Select(a => new DnsRecord
                {
                    Name = a.DomainName.Value,
                    Type = DnsRecordType.AAAA,
                    Value = a.Address.ToString(),
                    Ttl = (int?)a.TimeToLive
                });
            case QueryType.CNAME:
                return response.Answers.CnameRecords().Select(c => new DnsRecord
                {
                    Name = c.DomainName.Value,
                    Type = DnsRecordType.CNAME,
                    Value = c.CanonicalName.Value,
                    Ttl = (int?)c.TimeToLive
                });
            case QueryType.MX:
                return response.Answers.MxRecords().Select(mx => new DnsRecord
                {
                    Name = mx.DomainName.Value,
                    Type = DnsRecordType.MX,
                    Value = mx.Exchange.Value,
                    Priority = mx.Preference,
                    Ttl = (int?)mx.TimeToLive
                });
            case QueryType.TXT:
                return response.Answers.TxtRecords().Select(txt => new DnsRecord
                {
                    Name = txt.DomainName.Value,
                    Type = DnsRecordType.TXT,
                    Value = string.Join(" ", txt.Text),
                    Ttl = (int?)txt.TimeToLive
                });
            case QueryType.NS:
                return response.Answers.NsRecords().Select(ns => new DnsRecord
                {
                    Name = ns.DomainName.Value,
                    Type = DnsRecordType.NS,
                    Value = ns.NSDName.Value,
                    Ttl = (int?)ns.TimeToLive
                });
            case QueryType.SOA:
                return response.Answers.SoaRecords().Select(soa => new DnsRecord
                {
                    Name = soa.DomainName.Value,
                    Type = DnsRecordType.SOA,
                    Value = $"{soa.MName.Value} {soa.RName.Value} {soa.Serial} {soa.Refresh} {soa.Retry} {soa.Expire} {soa.Minimum}",
                    Ttl = (int?)soa.TimeToLive
                });
            default:
                return Array.Empty<DnsRecord>();
        }
    }

    private static async Task<string> QueryWhoisServerAsync(string server, string query, CancellationToken ct)
    {
        using var tcpClient = new TcpClient();
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
        cts.CancelAfter(TimeSpan.FromSeconds(7));

        await tcpClient.ConnectAsync(server, 43, cts.Token);

        await using var stream = tcpClient.GetStream();
        var requestBytes = Encoding.ASCII.GetBytes(query + "\r\n");
        await stream.WriteAsync(requestBytes, cts.Token);
        await stream.FlushAsync(cts.Token);

        var buffer = new byte[8192];
        var builder = new StringBuilder();
        int read;
        while ((read = await stream.ReadAsync(buffer, cts.Token)) > 0)
        {
            builder.Append(Encoding.ASCII.GetString(buffer, 0, read));
        }

        return builder.ToString();
    }

    private static string? TryParseWhoisReferral(string response)
    {
        using var reader = new StringReader(response);
        string? line;
        while ((line = reader.ReadLine()) is not null)
        {
            if (line.StartsWith("refer:", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("whois:", StringComparison.OrdinalIgnoreCase) ||
                line.StartsWith("referralserver:", StringComparison.OrdinalIgnoreCase))
            {
                var parts = line.Split(':', 2, StringSplitOptions.TrimEntries);
                if (parts.Length == 2)
                {
                    var value = parts[1].Trim();
                    if (value.StartsWith("whois://", StringComparison.OrdinalIgnoreCase))
                    {
                        value = value.Replace("whois://", "", StringComparison.OrdinalIgnoreCase);
                    }

                    if (!string.IsNullOrWhiteSpace(value))
                    {
                        return value;
                    }
                }
            }
        }

        return null;
    }

    private static bool TryParseMacAddress(string input, out byte[] macBytes)
    {
        macBytes = Array.Empty<byte>();

        var cleaned = input
            .Replace(":", "", StringComparison.Ordinal)
            .Replace("-", "", StringComparison.Ordinal)
            .Replace(".", "", StringComparison.Ordinal)
            .Trim();

        if (cleaned.Length != 12)
        {
            return false;
        }

        var bytes = new byte[6];
        for (int i = 0; i < 6; i++)
        {
            var hex = cleaned.Substring(i * 2, 2);
            if (!byte.TryParse(hex, System.Globalization.NumberStyles.HexNumber, null, out bytes[i]))
            {
                return false;
            }
        }

        macBytes = bytes;
        return true;
    }

    private static byte[] BuildMagicPacket(byte[] macBytes)
    {
        var packet = new byte[6 + 16 * macBytes.Length];
        for (int i = 0; i < 6; i++)
        {
            packet[i] = 0xFF;
        }

        for (int i = 0; i < 16; i++)
        {
            Buffer.BlockCopy(macBytes, 0, packet, 6 + i * macBytes.Length, macBytes.Length);
        }

        return packet;
    }

    private static SslCertificateInfo ToCertificateInfo(X509Certificate2 certificate)
    {
        return new SslCertificateInfo
        {
            Subject = certificate.Subject,
            Issuer = certificate.Issuer,
            NotBefore = certificate.NotBefore.ToUniversalTime(),
            NotAfter = certificate.NotAfter.ToUniversalTime(),
            Thumbprint = certificate.Thumbprint ?? string.Empty,
            SerialNumber = certificate.SerialNumber ?? string.Empty,
            SubjectAlternativeNames = ExtractSubjectAltNames(certificate),
            SignatureAlgorithm = certificate.SignatureAlgorithm?.FriendlyName,
            PublicKeyAlgorithm = certificate.PublicKey?.Oid?.FriendlyName,
            KeySize = GetPublicKeySize(certificate),
            IsSelfSigned = string.Equals(certificate.Subject, certificate.Issuer, StringComparison.OrdinalIgnoreCase)
        };
    }

    private static int? GetPublicKeySize(X509Certificate2 certificate)
    {
        using var rsa = certificate.GetRSAPublicKey();
        if (rsa is not null)
        {
            return rsa.KeySize;
        }

        using var ecdsa = certificate.GetECDsaPublicKey();
        if (ecdsa is not null)
        {
            return ecdsa.KeySize;
        }

        using var dsa = certificate.GetDSAPublicKey();
        if (dsa is not null)
        {
            return dsa.KeySize;
        }

        return null;
    }

    private static List<string> ExtractSubjectAltNames(X509Certificate2 certificate)
    {
        var extension = certificate.Extensions["2.5.29.17"];
        if (extension is null)
        {
            return [];
        }

        var formatted = extension.Format(false);
        if (string.IsNullOrWhiteSpace(formatted))
        {
            return [];
        }

        return formatted
            .Split([", ", ","], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(value => value
                .Replace("DNS Name=", "", StringComparison.OrdinalIgnoreCase)
                .Replace("IP Address=", "", StringComparison.OrdinalIgnoreCase))
            .ToList();
    }

    private readonly record struct PublicIpEndpoint(string Provider, Uri Url);

    private async Task<(string? ip, string? provider)> TryResolvePublicIpAsync(
        IEnumerable<PublicIpEndpoint> endpoints,
        CancellationToken ct)
    {
        foreach (var endpoint in endpoints)
        {
            try
            {
                var ip = await TryFetchPublicIpAsync(endpoint.Url, ct).ConfigureAwait(false);
                if (!string.IsNullOrWhiteSpace(ip))
                {
                    return (ip, endpoint.Provider);
                }
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                _logger.LogDebug(ex, "Public IP lookup failed for {Provider}", endpoint.Provider);
            }
        }

        return (null, null);
    }

    private async Task<string?> TryFetchPublicIpAsync(Uri url, CancellationToken ct)
    {
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
        request.Headers.UserAgent.ParseAdd("ManLab/1.0");

        using var response = await _httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, ct)
            .ConfigureAwait(false);

        if (!response.IsSuccessStatusCode)
        {
            return null;
        }

        var payload = await response.Content.ReadAsStringAsync(ct).ConfigureAwait(false);
        if (string.IsNullOrWhiteSpace(payload))
        {
            return null;
        }

        var trimmed = payload.Trim();
        if (trimmed.StartsWith("{", StringComparison.Ordinal))
        {
            using var doc = JsonDocument.Parse(trimmed);
            if (doc.RootElement.TryGetProperty("ip", out var ipElement))
            {
                var ipValue = ipElement.GetString();
                return IPAddress.TryParse(ipValue, out var parsed) ? parsed.ToString() : null;
            }

            if (doc.RootElement.TryGetProperty("ip_address", out var ipAddressElement))
            {
                var ipValue = ipAddressElement.GetString();
                return IPAddress.TryParse(ipValue, out var parsed) ? parsed.ToString() : null;
            }
        }

        return IPAddress.TryParse(trimmed, out var ip) ? ip.ToString() : null;
    }
}
