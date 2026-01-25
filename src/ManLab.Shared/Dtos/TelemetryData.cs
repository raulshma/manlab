namespace ManLab.Shared.Dtos;

/// <summary>
/// Telemetry data sent by an agent during heartbeat.
/// </summary>
public class TelemetryData
{
    /// <summary>CPU usage percentage (0-100).</summary>
    public float CpuPercent { get; set; }

    /// <summary>RAM currently used in bytes.</summary>
    public long RamUsedBytes { get; set; }

    /// <summary>Total RAM in bytes.</summary>
    public long RamTotalBytes { get; set; }

    /// <summary>Disk usage per mount point (mount point -> percentage).</summary>
    public Dictionary<string, float> DiskUsage { get; set; } = [];

    /// <summary>CPU temperature in Celsius (null if unavailable).</summary>
    public float? CpuTempCelsius { get; set; }

    // --- Enhancements: network + ping (optional) ---

    /// <summary>Receive rate on the primary interface in bytes/sec (null if unavailable).</summary>
    public long? NetRxBytesPerSec { get; set; }

    /// <summary>Transmit rate on the primary interface in bytes/sec (null if unavailable).</summary>
    public long? NetTxBytesPerSec { get; set; }

    /// <summary>Ping target hostname/IP used for connectivity checks (null if disabled).</summary>
    public string? PingTarget { get; set; }

    /// <summary>Ping round-trip time in milliseconds (null if unavailable).</summary>
    public float? PingRttMs { get; set; }

    /// <summary>Ping packet loss percentage over a rolling window (0-100, null if unavailable).</summary>
    public float? PingPacketLossPercent { get; set; }

    // --- Enhancements: hardware (optional) ---

    /// <summary>Optional GPU telemetry (0..n devices).</summary>
    public List<GpuTelemetry>? Gpus { get; set; }

    /// <summary>Optional UPS telemetry.</summary>
    public UpsTelemetry? Ups { get; set; }

    /// <summary>Enhanced GPU telemetry with detailed metrics (replaces basic Gpus when available).</summary>
    public List<EnhancedGpuTelemetry>? EnhancedGpus { get; set; }

    /// <summary>Enhanced network telemetry with per-interface stats, connections, and device discovery.</summary>
    public NetworkTelemetry? Network { get; set; }

    /// <summary>Application Performance Monitoring telemetry.</summary>
    public ApplicationPerformanceTelemetry? Apm { get; set; }

    // --- Agent process resource usage ---

    /// <summary>Agent process CPU usage percentage (0-100, null if unavailable).</summary>
    public float? AgentCpuPercent { get; set; }

    /// <summary>Agent process memory (working set) in bytes (null if unavailable).</summary>
    public long? AgentMemoryBytes { get; set; }

    /// <summary>Agent process GC heap size in bytes (null if unavailable).</summary>
    public long? AgentGcHeapBytes { get; set; }

    /// <summary>Agent process thread count (null if unavailable).</summary>
    public int? AgentThreadCount { get; set; }

    /// <summary>
    /// Top process snapshot (limited list) for high-fidelity diagnostics.
    /// </summary>
    public List<ProcessTelemetry>? TopProcesses { get; set; }
}

/// <summary>
/// Lightweight process telemetry snapshot.
/// </summary>
public sealed class ProcessTelemetry
{
    /// <summary>Process ID.</summary>
    public int ProcessId { get; set; }

    /// <summary>Process name (may be null if unavailable).</summary>
    public string? ProcessName { get; set; }

    /// <summary>CPU usage percentage (0-100, null if unavailable).</summary>
    public float? CpuPercent { get; set; }

    /// <summary>Working set memory in bytes (null if unavailable).</summary>
    public long? MemoryBytes { get; set; }
}

/// <summary>
/// GPU telemetry payload sent by the agent.
/// </summary>
public sealed class GpuTelemetry
{
    /// <summary>Vendor identifier (e.g. "nvidia", "intel", "amd", "unknown").</summary>
    public string Vendor { get; set; } = "unknown";

    /// <summary>GPU index as reported by the collector (0-based).</summary>
    public int Index { get; set; }

    public string? Name { get; set; }
    public float? UtilizationPercent { get; set; }
    public long? MemoryUsedBytes { get; set; }
    public long? MemoryTotalBytes { get; set; }
    public float? TemperatureC { get; set; }
}

/// <summary>
/// UPS telemetry payload sent by the agent.
/// </summary>
public sealed class UpsTelemetry
{
    /// <summary>Backend identifier (e.g. "nut", "apcupsd", "unknown").</summary>
    public string Backend { get; set; } = "unknown";

    public float? BatteryPercent { get; set; }
    public float? LoadPercent { get; set; }
    public bool? OnBattery { get; set; }
    public int? EstimatedRuntimeSeconds { get; set; }
}

/// <summary>
/// Service status snapshot payload pushed by an agent.
/// </summary>
public sealed class ServiceStatusSnapshotIngest
{
    public DateTime? Timestamp { get; set; }
    public string ServiceName { get; set; } = string.Empty;
    /// <summary>State string (e.g. "active", "inactive", "failed", "unknown").</summary>
    public string? State { get; set; }
    public string? Detail { get; set; }
}

/// <summary>
/// SMART drive snapshot payload pushed by an agent.
/// </summary>
public sealed class SmartDriveSnapshotIngest
{
    public DateTime? Timestamp { get; set; }
    public string Device { get; set; } = string.Empty;
    /// <summary>Health string (e.g. "pass", "fail", "unknown").</summary>
    public string? Health { get; set; }
    public float? TemperatureC { get; set; }
    public int? PowerOnHours { get; set; }
    /// <summary>Optional smartctl extract as JSON.</summary>
    public string? RawJson { get; set; }
}

/// <summary>
/// GPU snapshot payload pushed by an agent.
/// </summary>
public sealed class GpuSnapshotIngest
{
    public DateTime? Timestamp { get; set; }
    public int GpuIndex { get; set; }
    /// <summary>Vendor string (e.g. "nvidia", "intel", "amd", "unknown").</summary>
    public string? Vendor { get; set; }
    public string? Name { get; set; }
    public float? UtilizationPercent { get; set; }
    public long? MemoryUsedBytes { get; set; }
    public long? MemoryTotalBytes { get; set; }
    public float? TemperatureC { get; set; }
}

/// <summary>
/// UPS snapshot payload pushed by an agent.
/// </summary>
public sealed class UpsSnapshotIngest
{
    public DateTime? Timestamp { get; set; }
    /// <summary>Backend string (e.g. "nut", "apcupsd", "unknown").</summary>
    public string? Backend { get; set; }
    public float? BatteryPercent { get; set; }
    public float? LoadPercent { get; set; }
    public bool? OnBattery { get; set; }
    public int? EstimatedRuntimeSeconds { get; set; }
}
