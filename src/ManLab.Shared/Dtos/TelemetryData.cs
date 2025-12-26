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
}
