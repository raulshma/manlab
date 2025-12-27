using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;
using System.Net.NetworkInformation;
using ManLab.Agent.Configuration;
using ManLab.Agent.Networking;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Linux-specific telemetry collector using /proc filesystem.
/// </summary>
public sealed class LinuxTelemetryCollector : ITelemetryCollector
{
    private readonly ILogger<LinuxTelemetryCollector> _logger;
    private readonly AgentConfiguration _config;
    private readonly int _cacheSeconds;

    private readonly GpuTelemetryCollector _gpuCollector;
    private readonly UpsTelemetryCollector _upsCollector;
    
    // Previous CPU times for calculating usage
    private long _prevTotal;
    private long _prevIdle;
    private bool _initialized;

    // Drive info cache to reduce I/O overhead
    private Dictionary<string, float>? _cachedDiskUsage;
    private DateTime _lastDiskCheck = DateTime.MinValue;

    // Network throughput state
    private string? _primaryInterfaceName;
    private long? _prevRxBytes;
    private long? _prevTxBytes;
    private DateTime _prevNetSampleAtUtc;

    // Ping state
    private RollingPingWindow? _pingWindow;
    private string? _resolvedPingTarget;

    public LinuxTelemetryCollector(ILogger<LinuxTelemetryCollector> logger, AgentConfiguration config)
    {
        _logger = logger;
        _config = config;
        _cacheSeconds = config.TelemetryCacheSeconds;

        _gpuCollector = new GpuTelemetryCollector(_logger, _config);
        _upsCollector = new UpsTelemetryCollector(_logger, _config);
    }

    public TelemetryData Collect()
    {
        var data = new TelemetryData();

        try
        {
            data.CpuPercent = GetCpuUsage();
            (data.RamUsedBytes, data.RamTotalBytes) = GetMemoryInfo();
            data.DiskUsage = GetDiskUsage();
            data.CpuTempCelsius = GetCpuTemperature();

            PopulateNetworkTelemetry(data);
            PopulatePingTelemetry(data);

            // Optional: advanced hardware stats.
            data.Gpus = _gpuCollector.Collect();
            data.Ups = _upsCollector.Collect();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error collecting telemetry data");
        }

        return data;
    }

    private void PopulateNetworkTelemetry(TelemetryData data)
    {
        if (!_config.EnableNetworkTelemetry)
        {
            return;
        }

        _primaryInterfaceName ??= NetworkInterfaceSelector.SelectPrimaryInterfaceName(_config.PrimaryInterfaceName, _logger);
        var nic = NetworkInterfaceSelector.TryGetInterfaceByName(_primaryInterfaceName);
        if (nic is null)
        {
            // Re-try detection in case interfaces changed.
            _primaryInterfaceName = NetworkInterfaceSelector.SelectPrimaryInterfaceName(null, _logger);
            nic = NetworkInterfaceSelector.TryGetInterfaceByName(_primaryInterfaceName);
        }

        if (nic is null)
        {
            return;
        }

        if (!NetworkInterfaceSelector.TryGetIpv4ByteCounters(nic, out var rx, out var tx))
        {
            return;
        }

        var now = DateTime.UtcNow;
        if (_prevRxBytes is null || _prevTxBytes is null || _prevNetSampleAtUtc == default)
        {
            _prevRxBytes = rx;
            _prevTxBytes = tx;
            _prevNetSampleAtUtc = now;
            return;
        }

        var elapsedSeconds = (now - _prevNetSampleAtUtc).TotalSeconds;
        if (elapsedSeconds <= 0.5)
        {
            return;
        }

        var drx = rx - _prevRxBytes.Value;
        var dtx = tx - _prevTxBytes.Value;

        // Defensive: counters can reset on interface bounce.
        if (drx < 0 || dtx < 0)
        {
            _prevRxBytes = rx;
            _prevTxBytes = tx;
            _prevNetSampleAtUtc = now;
            return;
        }

        data.NetRxBytesPerSec = (long)(drx / elapsedSeconds);
        data.NetTxBytesPerSec = (long)(dtx / elapsedSeconds);

        _prevRxBytes = rx;
        _prevTxBytes = tx;
        _prevNetSampleAtUtc = now;
    }

    private void PopulatePingTelemetry(TelemetryData data)
    {
        if (!_config.EnablePingTelemetry)
        {
            return;
        }

        if (_config.PingWindowSize < 1)
        {
            return;
        }

        _pingWindow ??= new RollingPingWindow(_config.PingWindowSize);

        _primaryInterfaceName ??= NetworkInterfaceSelector.SelectPrimaryInterfaceName(_config.PrimaryInterfaceName, _logger);
        _resolvedPingTarget ??= ResolvePingTarget(_primaryInterfaceName);

        if (string.IsNullOrWhiteSpace(_resolvedPingTarget))
        {
            return;
        }

        data.PingTarget = _resolvedPingTarget;

        try
        {
            using var ping = new Ping();
            var reply = ping.Send(_resolvedPingTarget, Math.Max(50, _config.PingTimeoutMs));

            var success = reply.Status == IPStatus.Success;
            var rttMs = success ? (float)reply.RoundtripTime : 0f;

            _pingWindow.Add(success, rttMs);

            var (avgRtt, loss, _) = _pingWindow.GetStats();
            data.PingRttMs = avgRtt;
            data.PingPacketLossPercent = loss;
        }
        catch (Exception ex)
        {
            // ICMP may be blocked/require extra privileges on some Linux systems.
            _logger.LogDebug(ex, "Ping telemetry failed");
        }
    }

    private string ResolvePingTarget(string? primaryInterfaceName)
    {
        var configured = _config.PingTarget?.Trim();
        if (!string.IsNullOrWhiteSpace(configured))
        {
            return configured;
        }

        var nic = NetworkInterfaceSelector.TryGetInterfaceByName(primaryInterfaceName);
        var gw = nic is not null ? NetworkInterfaceSelector.TryGetDefaultGatewayIpv4(nic) : null;
        if (!string.IsNullOrWhiteSpace(gw))
        {
            return gw;
        }

        return "1.1.1.1";
    }

    private float GetCpuUsage()
    {
        try
        {
            // Read /proc/stat - first line is aggregate CPU stats
            var statLine = File.ReadLines("/proc/stat").FirstOrDefault();
            if (statLine == null || !statLine.StartsWith("cpu "))
            {
                return 0;
            }

            // Parse: cpu user nice system idle iowait irq softirq steal guest guest_nice
            var parts = statLine.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 5)
            {
                return 0;
            }

            // Sum all CPU times
            long user = long.Parse(parts[1]);
            long nice = long.Parse(parts[2]);
            long system = long.Parse(parts[3]);
            long idle = long.Parse(parts[4]);
            long iowait = parts.Length > 5 ? long.Parse(parts[5]) : 0;
            long irq = parts.Length > 6 ? long.Parse(parts[6]) : 0;
            long softirq = parts.Length > 7 ? long.Parse(parts[7]) : 0;
            long steal = parts.Length > 8 ? long.Parse(parts[8]) : 0;

            long totalIdle = idle + iowait;
            long total = user + nice + system + idle + iowait + irq + softirq + steal;

            if (!_initialized)
            {
                _prevTotal = total;
                _prevIdle = totalIdle;
                _initialized = true;
                return 0;
            }

            long totalDiff = total - _prevTotal;
            long idleDiff = totalIdle - _prevIdle;

            _prevTotal = total;
            _prevIdle = totalIdle;

            if (totalDiff == 0)
            {
                return 0;
            }

            return (float)(totalDiff - idleDiff) / totalDiff * 100f;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error reading CPU stats from /proc/stat");
            return 0;
        }
    }

    private (long used, long total) GetMemoryInfo()
    {
        try
        {
            long memTotal = 0;
            long memAvailable = 0;
            long memFree = 0;
            long buffers = 0;
            long cached = 0;

            foreach (var line in File.ReadLines("/proc/meminfo"))
            {
                var parts = line.Split(':', StringSplitOptions.TrimEntries);
                if (parts.Length < 2) continue;

                var key = parts[0];
                var valueParts = parts[1].Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (valueParts.Length == 0) continue;

                long value = long.Parse(valueParts[0]) * 1024; // Convert from kB to bytes

                switch (key)
                {
                    case "MemTotal":
                        memTotal = value;
                        break;
                    case "MemAvailable":
                        memAvailable = value;
                        break;
                    case "MemFree":
                        memFree = value;
                        break;
                    case "Buffers":
                        buffers = value;
                        break;
                    case "Cached":
                        cached = value;
                        break;
                }
            }

            // MemAvailable is the best metric if available (Linux 3.14+)
            // Otherwise, use MemFree + Buffers + Cached as approximation
            long available = memAvailable > 0 ? memAvailable : memFree + buffers + cached;
            long used = memTotal - available;

            return (used, memTotal);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error reading memory info from /proc/meminfo");
            return (0, 0);
        }
    }

    private Dictionary<string, float> GetDiskUsage()
    {
        // Return cached data if still valid
        if (_cachedDiskUsage != null && (DateTime.UtcNow - _lastDiskCheck).TotalSeconds < _cacheSeconds)
        {
            return _cachedDiskUsage;
        }

        var usage = new Dictionary<string, float>();

        try
        {
            // Use DriveInfo which works on Linux too via .NET runtime
            foreach (var drive in DriveInfo.GetDrives())
            {
                if (drive.IsReady && (drive.DriveType == DriveType.Fixed || drive.DriveType == DriveType.Network))
                {
                    // Skip pseudo filesystems
                    if (drive.Name.StartsWith("/dev") || 
                        drive.Name.StartsWith("/proc") || 
                        drive.Name.StartsWith("/sys") ||
                        drive.Name.StartsWith("/run"))
                    {
                        continue;
                    }

                    if (drive.TotalSize > 0)
                    {
                        float percent = (float)(drive.TotalSize - drive.AvailableFreeSpace) / drive.TotalSize * 100f;
                        usage[drive.Name] = percent;
                    }
                }
            }

            // Cache the results
            _cachedDiskUsage = usage;
            _lastDiskCheck = DateTime.UtcNow;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error getting disk usage");
        }

        return usage;
    }

    private float? GetCpuTemperature()
    {
        try
        {
            // Try common temperature sensor paths
            string[] tempPaths = [
                "/sys/class/thermal/thermal_zone0/temp",
                "/sys/class/hwmon/hwmon0/temp1_input",
                "/sys/class/hwmon/hwmon1/temp1_input"
            ];

            foreach (var path in tempPaths)
            {
                if (File.Exists(path))
                {
                    var content = File.ReadAllText(path).Trim();
                    if (int.TryParse(content, out int tempMilliCelsius))
                    {
                        return tempMilliCelsius / 1000f;
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Could not read CPU temperature");
        }

        return null;
    }
}

