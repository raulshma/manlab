using System.Runtime.InteropServices;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Windows-specific telemetry collector using P/Invoke.
/// </summary>
public partial class WindowsTelemetryCollector : ITelemetryCollector
{
    private readonly ILogger<WindowsTelemetryCollector> _logger;
    
    // Previous CPU times for calculating usage
    private long _prevIdleTime;
    private long _prevKernelTime;
    private long _prevUserTime;
    private bool _initialized;

    public WindowsTelemetryCollector(ILogger<WindowsTelemetryCollector> logger)
    {
        _logger = logger;
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
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Error collecting telemetry data");
        }

        return data;
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
