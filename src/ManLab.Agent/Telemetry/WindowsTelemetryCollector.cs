using System.Runtime.InteropServices;
using System.Net.NetworkInformation;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;
using ManLab.Agent.Configuration;
using ManLab.Agent.Networking;
using System.Net.Http;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Windows-specific telemetry collector using P/Invoke.
/// </summary>
public partial class WindowsTelemetryCollector : ITelemetryCollector
{
    private readonly ILogger<WindowsTelemetryCollector> _logger;
    private readonly AgentConfiguration _config;
    private readonly int _cacheSeconds;

    private readonly GpuTelemetryCollector _gpuCollector;
    private readonly UpsTelemetryCollector _upsCollector;
    private readonly EnhancedNetworkTelemetryCollector _enhancedNetworkCollector;
    private readonly EnhancedGpuTelemetryCollector _enhancedGpuCollector;
    private readonly ApplicationPerformanceCollector _apmCollector;
    private readonly ProcessTelemetryCollector _processCollector;

    // Previous CPU times for calculating usage
    private long _prevIdleTime;
    private long _prevKernelTime;
    private long _prevUserTime;
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

    public WindowsTelemetryCollector(ILogger<WindowsTelemetryCollector> logger, AgentConfiguration config, IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _config = config;
        _cacheSeconds = config.TelemetryCacheSeconds;

        _gpuCollector = new GpuTelemetryCollector(_logger, _config);
        _upsCollector = new UpsTelemetryCollector(_logger, _config);
        _enhancedNetworkCollector = new EnhancedNetworkTelemetryCollector(_logger, _config);
        _enhancedGpuCollector = new EnhancedGpuTelemetryCollector(_logger, _config);
        _apmCollector = new ApplicationPerformanceCollector(_logger, _config, httpClientFactory);
        _processCollector = new ProcessTelemetryCollector(_logger);
    }

    public TelemetryData Collect()
    {
        var data = new TelemetryData();

        try
        {
            data.CpuPercent = GetCpuUsage();
            (data.RamUsedBytes, data.RamTotalBytes) = GetMemoryInfo();
            data.DiskUsage = GetDiskUsage();
            data.CpuTempCelsius = null; // Temperature not reliably available on Windows without WMI

            PopulateNetworkTelemetry(data);
            PopulatePingTelemetry(data);
            PopulateAgentResourceUsage(data);

            // Optional: advanced hardware stats.
            data.Gpus = _gpuCollector.Collect();
            data.Ups = _upsCollector.Collect();

            // Enhanced telemetry collectors
            data.Network = _enhancedNetworkCollector.Collect();
            data.EnhancedGpus = _enhancedGpuCollector.Collect();
            data.Apm = _apmCollector.Collect();
            data.TopProcesses = _processCollector.Collect();
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error collecting telemetry data");
        }

        return data;
    }

    // Agent process CPU tracking state
    private TimeSpan _prevAgentCpuTime;
    private DateTime _prevAgentSampleAtUtc;
    private bool _agentCpuInitialized;

    private void PopulateAgentResourceUsage(TelemetryData data)
    {
        try
        {
            using var currentProcess = System.Diagnostics.Process.GetCurrentProcess();

            // Memory stats (working set)
            data.AgentMemoryBytes = currentProcess.WorkingSet64;

            // GC heap size
            data.AgentGcHeapBytes = GC.GetTotalMemory(forceFullCollection: false);

            // Thread count
            data.AgentThreadCount = currentProcess.Threads.Count;

            // CPU usage (delta-based calculation)
            var now = DateTime.UtcNow;
            var cpuTime = currentProcess.TotalProcessorTime;

            if (!_agentCpuInitialized)
            {
                _prevAgentCpuTime = cpuTime;
                _prevAgentSampleAtUtc = now;
                _agentCpuInitialized = true;
                return;
            }

            var elapsed = now - _prevAgentSampleAtUtc;
            if (elapsed.TotalSeconds < 0.5)
            {
                return;
            }

            var cpuDelta = cpuTime - _prevAgentCpuTime;
            var cpuPercent = (float)(cpuDelta.TotalMilliseconds / elapsed.TotalMilliseconds / Environment.ProcessorCount * 100);

            // Clamp to valid range
            data.AgentCpuPercent = Math.Clamp(cpuPercent, 0f, 100f);

            _prevAgentCpuTime = cpuTime;
            _prevAgentSampleAtUtc = now;
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to collect agent resource usage");
        }
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
        if (!GetSystemTimes(out var idleTime, out var kernelTime, out var userTime))
        {
            _logger.LogWarning("Failed to get system times");
            return 0;
        }

        long idle = FileTimeToLong(idleTime);
        long kernel = FileTimeToLong(kernelTime);
        long user = FileTimeToLong(userTime);

        if (!_initialized)
        {
            _prevIdleTime = idle;
            _prevKernelTime = kernel;
            _prevUserTime = user;
            _initialized = true;
            return 0;
        }

        long idleDiff = idle - _prevIdleTime;
        long kernelDiff = kernel - _prevKernelTime;
        long userDiff = user - _prevUserTime;

        _prevIdleTime = idle;
        _prevKernelTime = kernel;
        _prevUserTime = user;

        long total = kernelDiff + userDiff;
        if (total == 0)
        {
            return 0;
        }

        // Kernel time includes idle time, so subtract idle from kernel
        long active = total - idleDiff;
        return (float)active / total * 100f;
    }

    private (long used, long total) GetMemoryInfo()
    {
        var memInfo = new MEMORYSTATUSEX { dwLength = (uint)Marshal.SizeOf<MEMORYSTATUSEX>() };

        if (!GlobalMemoryStatusEx(ref memInfo))
        {
            _logger.LogWarning("Failed to get memory status");
            return (0, 0);
        }

        long total = (long)memInfo.ullTotalPhys;
        long available = (long)memInfo.ullAvailPhys;
        long used = total - available;

        return (used, total);
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
            foreach (var drive in DriveInfo.GetDrives())
            {
                if (drive.IsReady && drive.DriveType == DriveType.Fixed)
                {
                    float percent = (float)(drive.TotalSize - drive.AvailableFreeSpace) / drive.TotalSize * 100f;
                    usage[drive.Name] = percent;
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

    private static long FileTimeToLong(FILETIME ft)
    {
        return ((long)ft.dwHighDateTime << 32) | (uint)ft.dwLowDateTime;
    }

    #region P/Invoke Declarations

    [StructLayout(LayoutKind.Sequential)]
    private struct FILETIME
    {
        public uint dwLowDateTime;
        public uint dwHighDateTime;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct MEMORYSTATUSEX
    {
        public uint dwLength;
        public uint dwMemoryLoad;
        public ulong ullTotalPhys;
        public ulong ullAvailPhys;
        public ulong ullTotalPageFile;
        public ulong ullAvailPageFile;
        public ulong ullTotalVirtual;
        public ulong ullAvailVirtual;
        public ulong ullAvailExtendedVirtual;
    }

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GetSystemTimes(
        out FILETIME lpIdleTime,
        out FILETIME lpKernelTime,
        out FILETIME lpUserTime);

    [LibraryImport("kernel32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static partial bool GlobalMemoryStatusEx(ref MEMORYSTATUSEX lpBuffer);

    #endregion
}

