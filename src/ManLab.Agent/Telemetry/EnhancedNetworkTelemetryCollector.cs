using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Enhanced network telemetry collector providing per-interface bandwidth,
/// latency measurements, connection tracking, and device discovery.
/// </summary>
internal sealed class EnhancedNetworkTelemetryCollector
{
    private readonly ILogger _logger;
    private readonly AgentConfiguration _config;

    // Per-interface state for delta calculations
    private readonly Dictionary<string, InterfaceState> _interfaceStates = new();
    private DateTime _lastSampleAtUtc;

    // Device discovery cache
    private List<DiscoveredDevice>? _discoveredDevices;
    private DateTime _lastDiscoveryScanUtc;

    // Latency measurement state
    private readonly Dictionary<string, LatencyWindow> _latencyWindows = new();

    public EnhancedNetworkTelemetryCollector(ILogger logger, AgentConfiguration config)
    {
        _logger = logger;
        _config = config;
    }

    public NetworkTelemetry? Collect()
    {
        // Enhanced network telemetry can be significantly more expensive than basic throughput stats
        // (interface enumeration, connection listing, optional device discovery).
        // Keep it behind its own explicit toggle.
        if (!_config.EnableNetworkTelemetry || !_config.EnableEnhancedNetworkTelemetry)
        {
            return null;
        }

        try
        {
            var telemetry = new NetworkTelemetry();

            // Collect per-interface statistics
            telemetry.Interfaces = CollectInterfaceStats();

            // Collect latency measurements
            telemetry.LatencyMeasurements = CollectLatencyMeasurements();

            // Collect connection summary
            telemetry.Connections = CollectConnectionsSummary();

            // Device discovery (less frequent, but can still be noisy on low-power networks)
            if (ShouldRunDeviceDiscovery())
            {
                _discoveredDevices = DiscoverDevices();
                _lastDiscoveryScanUtc = DateTime.UtcNow;
            }

            telemetry.DiscoveredDevices = _discoveredDevices ?? [];
            telemetry.LastDiscoveryScanUtc = _lastDiscoveryScanUtc == default ? null : _lastDiscoveryScanUtc;

            return telemetry;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Enhanced network telemetry collection failed");
            return null;
        }
    }

    private List<NetworkInterfaceTelemetry> CollectInterfaceStats()
    {
        var result = new List<NetworkInterfaceTelemetry>();
        var now = DateTime.UtcNow;
        var elapsed = _lastSampleAtUtc == default ? 0 : (now - _lastSampleAtUtc).TotalSeconds;

        try
        {
            var interfaces = NetworkInterface.GetAllNetworkInterfaces()
                .Where(nic => nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .Where(nic => nic.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .ToList();

            foreach (var nic in interfaces)
            {
                try
                {
                    var stats = nic.GetIPStatistics();
                    var props = nic.GetIPProperties();

                    var ifTelemetry = new NetworkInterfaceTelemetry
                    {
                        Name = nic.Name,
                        Description = nic.Description,
                        InterfaceType = nic.NetworkInterfaceType.ToString(),
                        Status = nic.OperationalStatus.ToString(),
                        SpeedBps = nic.Speed > 0 ? nic.Speed : null,
                        MacAddress = FormatMacAddress(nic.GetPhysicalAddress()),
                        IPv4Addresses = props.UnicastAddresses
                            .Where(a => a.Address.AddressFamily == AddressFamily.InterNetwork)
                            .Select(a => a.Address.ToString())
                            .ToList(),
                        IPv6Addresses = props.UnicastAddresses
                            .Where(a => a.Address.AddressFamily == AddressFamily.InterNetworkV6)
                            .Select(a => a.Address.ToString())
                            .ToList(),
                        TotalRxBytes = stats.BytesReceived,
                        TotalTxBytes = stats.BytesSent,
                        RxErrors = stats.IncomingPacketsWithErrors,
                        TxErrors = stats.OutgoingPacketsWithErrors,
                        RxDropped = !RuntimeInformation.IsOSPlatform(OSPlatform.OSX) ? stats.IncomingPacketsDiscarded : null,
                        TxDropped = !RuntimeInformation.IsOSPlatform(OSPlatform.OSX) ? stats.OutgoingPacketsDiscarded : null
                    };

                    // Calculate rates if we have previous data
                    if (elapsed > 0 && _interfaceStates.TryGetValue(nic.Name, out var prevState))
                    {
                        var rxDelta = stats.BytesReceived - prevState.RxBytes;
                        var txDelta = stats.BytesSent - prevState.TxBytes;
                        var rxPacketDelta = stats.UnicastPacketsReceived - prevState.RxPackets;
                        var txPacketDelta = stats.UnicastPacketsSent - prevState.TxPackets;

                        ifTelemetry.RxBytesPerSec = (long)(rxDelta / elapsed);
                        ifTelemetry.TxBytesPerSec = (long)(txDelta / elapsed);
                        ifTelemetry.RxPacketsPerSec = (long)(rxPacketDelta / elapsed);
                        ifTelemetry.TxPacketsPerSec = (long)(txPacketDelta / elapsed);

                        // Calculate utilization if speed is known
                        if (nic.Speed > 0)
                        {
                            var totalBytesPerSec = (rxDelta + txDelta) / elapsed;
                            var maxBytesPerSec = nic.Speed / 8.0;
                            ifTelemetry.UtilizationPercent = (float)Math.Min(100, (totalBytesPerSec / maxBytesPerSec) * 100);
                        }
                    }

                    // Update state for next calculation
                    _interfaceStates[nic.Name] = new InterfaceState
                    {
                        RxBytes = stats.BytesReceived,
                        TxBytes = stats.BytesSent,
                        RxPackets = stats.UnicastPacketsReceived,
                        TxPackets = stats.UnicastPacketsSent
                    };

                    result.Add(ifTelemetry);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Failed to collect stats for interface {Name}", nic.Name);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to enumerate network interfaces");
        }

        _lastSampleAtUtc = now;
        return result;
    }

    private List<LatencyMeasurement> CollectLatencyMeasurements()
    {
        var result = new List<LatencyMeasurement>();

        // Default targets: gateway and public DNS
        var targets = GetLatencyTargets();

        foreach (var target in targets)
        {
            try
            {
                var measurement = MeasureLatency(target);
                if (measurement != null)
                {
                    result.Add(measurement);
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to measure latency to {Target}", target);
            }
        }

        return result;
    }

    private List<string> GetLatencyTargets()
    {
        var targets = new List<string>();

        // Add configured ping target if set
        if (!string.IsNullOrWhiteSpace(_config.PingTarget))
        {
            targets.Add(_config.PingTarget);
        }

        // Try to get default gateway
        try
        {
            var gateway = NetworkInterface.GetAllNetworkInterfaces()
                .Where(nic => nic.OperationalStatus == OperationalStatus.Up)
                .SelectMany(nic => nic.GetIPProperties().GatewayAddresses)
                .FirstOrDefault(g => g.Address.AddressFamily == AddressFamily.InterNetwork)?
                .Address.ToString();

            if (!string.IsNullOrEmpty(gateway) && !targets.Contains(gateway))
            {
                targets.Add(gateway);
            }
        }
        catch { }

        // Add public DNS as fallback
        if (!targets.Contains("1.1.1.1"))
        {
            targets.Add("1.1.1.1");
        }

        return targets.Take(3).ToList(); // Limit to 3 targets
    }

    private LatencyMeasurement? MeasureLatency(string target)
    {
        if (!_latencyWindows.TryGetValue(target, out var window))
        {
            window = new LatencyWindow(_config.PingWindowSize);
            _latencyWindows[target] = window;
        }

        using var ping = new Ping();
        try
        {
            var reply = ping.Send(target, _config.PingTimeoutMs);
            window.AddSample(reply.Status == IPStatus.Success, reply.Status == IPStatus.Success ? reply.RoundtripTime : null);
        }
        catch
        {
            window.AddSample(false, null);
        }

        var stats = window.GetStats();
        return new LatencyMeasurement
        {
            Target = target,
            RttMs = stats.LastRtt,
            MinRttMs = stats.MinRtt,
            MaxRttMs = stats.MaxRtt,
            AvgRttMs = stats.AvgRtt,
            PacketLossPercent = stats.PacketLossPercent,
            JitterMs = stats.Jitter
        };
    }


    private ConnectionsSummary? CollectConnectionsSummary()
    {
        try
        {
            var properties = IPGlobalProperties.GetIPGlobalProperties();
            var tcpConnections = properties.GetActiveTcpConnections();
            var tcpListeners = properties.GetActiveTcpListeners();
            var udpListeners = properties.GetActiveUdpListeners();

            var summary = new ConnectionsSummary
            {
                TcpEstablished = tcpConnections.Count(c => c.State == TcpState.Established),
                TcpTimeWait = tcpConnections.Count(c => c.State == TcpState.TimeWait),
                TcpCloseWait = tcpConnections.Count(c => c.State == TcpState.CloseWait),
                TcpListening = tcpListeners.Length,
                UdpEndpoints = udpListeners.Length
            };

            // Get top connections (by remote address, grouped)
            var topConnections = tcpConnections
                .Where(c => c.State == TcpState.Established)
                .GroupBy(c => c.RemoteEndPoint.Address.ToString())
                .OrderByDescending(g => g.Count())
                .Take(10)
                .SelectMany(g => g.Take(1))
                .Select(c => new ConnectionInfo
                {
                    LocalEndpoint = $"{c.LocalEndPoint.Address}:{c.LocalEndPoint.Port}",
                    RemoteEndpoint = $"{c.RemoteEndPoint.Address}:{c.RemoteEndPoint.Port}",
                    State = c.State.ToString()
                })
                .ToList();

            summary.TopConnections = topConnections;
            return summary;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to collect connection summary");
            return null;
        }
    }

    private bool ShouldRunDeviceDiscovery()
    {
        // Run discovery every 5 minutes
        const int discoveryIntervalSeconds = 300;
        return _lastDiscoveryScanUtc == default ||
               (DateTime.UtcNow - _lastDiscoveryScanUtc).TotalSeconds >= discoveryIntervalSeconds;
    }

    private List<DiscoveredDevice> DiscoverDevices()
    {
        var devices = new List<DiscoveredDevice>();

        try
        {
            // Get local subnet
            var localAddresses = GetLocalIPv4Addresses();
            if (localAddresses.Count == 0)
            {
                return devices;
            }

            // Scan local subnet (limited to /24 for performance)
            foreach (var localAddr in localAddresses.Take(1))
            {
                var subnet = GetSubnetAddresses(localAddr, 24).Take(254);

                Parallel.ForEach(subnet, new ParallelOptions { MaxDegreeOfParallelism = 32 }, ip =>
                {
                    try
                    {
                        using var ping = new Ping();
                        var reply = ping.Send(ip, 100);

                        if (reply.Status == IPStatus.Success)
                        {
                            var device = new DiscoveredDevice
                            {
                                IpAddress = ip.ToString(),
                                IsReachable = true,
                                ResponseTimeMs = reply.RoundtripTime,
                                FirstSeenUtc = DateTime.UtcNow,
                                LastSeenUtc = DateTime.UtcNow
                            };

                            // Try to resolve hostname
                            try
                            {
                                var hostEntry = Dns.GetHostEntry(ip);
                                device.Hostname = hostEntry.HostName;
                            }
                            catch { }

                            // Try to get MAC from ARP cache
                            device.MacAddress = GetMacFromArpCache(ip.ToString());

                            lock (devices)
                            {
                                devices.Add(device);
                            }
                        }
                    }
                    catch { }
                });
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Device discovery failed");
        }

        return devices.OrderBy(d => d.IpAddress).ToList();
    }

    private static List<IPAddress> GetLocalIPv4Addresses()
    {
        return NetworkInterface.GetAllNetworkInterfaces()
            .Where(nic => nic.OperationalStatus == OperationalStatus.Up)
            .Where(nic => nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
            .SelectMany(nic => nic.GetIPProperties().UnicastAddresses)
            .Where(addr => addr.Address.AddressFamily == AddressFamily.InterNetwork)
            .Where(addr => !IPAddress.IsLoopback(addr.Address))
            .Select(addr => addr.Address)
            .ToList();
    }

    private static IEnumerable<IPAddress> GetSubnetAddresses(IPAddress localAddress, int prefixLength)
    {
        var bytes = localAddress.GetAddressBytes();
        var baseAddr = (uint)((bytes[0] << 24) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]);
        var mask = prefixLength == 0 ? 0 : uint.MaxValue << (32 - prefixLength);
        var network = baseAddr & mask;

        var hostCount = (1u << (32 - prefixLength)) - 2;
        for (uint i = 1; i <= hostCount && i <= 254; i++)
        {
            var addr = network + i;
            yield return new IPAddress(new[]
            {
                (byte)(addr >> 24),
                (byte)(addr >> 16),
                (byte)(addr >> 8),
                (byte)addr
            });
        }
    }

    private static string? GetMacFromArpCache(string ipAddress)
    {
        // Platform-specific ARP cache lookup
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return GetMacFromArpWindows(ipAddress);
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            return GetMacFromArpLinux(ipAddress);
        }
        return null;
    }

    private static string? GetMacFromArpWindows(string ipAddress)
    {
        try
        {
            if (!ExternalToolRunner.TryRun("arp", $"-a {ipAddress}", 1000, out var output, out _))
            {
                return null;
            }

            // Parse ARP output for MAC address
            var lines = output.Split('\n', StringSplitOptions.RemoveEmptyEntries);
            foreach (var line in lines)
            {
                if (line.Contains(ipAddress))
                {
                    var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 2)
                    {
                        var mac = parts.FirstOrDefault(p => p.Contains('-') && p.Length >= 17);
                        if (mac != null)
                        {
                            return mac.ToUpperInvariant().Replace('-', ':');
                        }
                    }
                }
            }
        }
        catch { }
        return null;
    }

    private static string? GetMacFromArpLinux(string ipAddress)
    {
        try
        {
            // Try /proc/net/arp first
            if (File.Exists("/proc/net/arp"))
            {
                var lines = File.ReadAllLines("/proc/net/arp");
                foreach (var line in lines.Skip(1))
                {
                    var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                    if (parts.Length >= 4 && parts[0] == ipAddress)
                    {
                        return parts[3].ToUpperInvariant();
                    }
                }
            }
        }
        catch { }
        return null;
    }

    private static string? FormatMacAddress(PhysicalAddress address)
    {
        var bytes = address.GetAddressBytes();
        if (bytes.Length == 0)
        {
            return null;
        }
        return string.Join(":", bytes.Select(b => b.ToString("X2")));
    }

    private sealed class InterfaceState
    {
        public long RxBytes { get; init; }
        public long TxBytes { get; init; }
        public long RxPackets { get; init; }
        public long TxPackets { get; init; }
    }

    private sealed class LatencyWindow
    {
        private readonly int _size;
        private readonly Queue<(bool Success, long? RttMs)> _samples = new();

        public LatencyWindow(int size)
        {
            _size = Math.Max(1, size);
        }

        public void AddSample(bool success, long? rttMs)
        {
            _samples.Enqueue((success, rttMs));
            while (_samples.Count > _size)
            {
                _samples.Dequeue();
            }
        }

        public LatencyStats GetStats()
        {
            var samples = _samples.ToList();
            var successfulRtts = samples.Where(s => s.Success && s.RttMs.HasValue).Select(s => s.RttMs!.Value).ToList();

            var stats = new LatencyStats
            {
                PacketLossPercent = samples.Count > 0 ? (float)(samples.Count(s => !s.Success) * 100.0 / samples.Count) : null
            };

            if (successfulRtts.Count > 0)
            {
                stats.LastRtt = successfulRtts.Last();
                stats.MinRtt = successfulRtts.Min();
                stats.MaxRtt = successfulRtts.Max();
                stats.AvgRtt = (float)successfulRtts.Average();

                // Calculate jitter (average deviation from mean)
                if (successfulRtts.Count > 1)
                {
                    var avg = successfulRtts.Average();
                    stats.Jitter = (float)successfulRtts.Select(r => Math.Abs(r - avg)).Average();
                }
            }

            return stats;
        }
    }

    private sealed class LatencyStats
    {
        public float? LastRtt { get; set; }
        public float? MinRtt { get; set; }
        public float? MaxRtt { get; set; }
        public float? AvgRtt { get; set; }
        public float? PacketLossPercent { get; set; }
        public float? Jitter { get; set; }
    }
}
