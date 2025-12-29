using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents a snapshot of telemetry data from an agent node.
/// </summary>
[Table("TelemetrySnapshots")]
public class TelemetrySnapshot
{
    /// <summary>Unique identifier for the telemetry snapshot.</summary>
    [Key]
    public long Id { get; set; }

    /// <summary>Foreign key to the node that reported this telemetry.</summary>
    public Guid NodeId { get; set; }

    /// <summary>Timestamp when this telemetry was recorded.</summary>
    public DateTime Timestamp { get; set; }

    /// <summary>CPU usage percentage (0-100).</summary>
    public float CpuUsage { get; set; }

    /// <summary>RAM usage percentage (0-100).</summary>
    public float RamUsage { get; set; }

    /// <summary>Disk usage percentage (0-100).</summary>
    public float DiskUsage { get; set; }

    /// <summary>CPU temperature in Celsius (nullable for systems without temp sensors).</summary>
    public float? Temperature { get; set; }

    /// <summary>Receive rate on the primary interface in bytes/sec (nullable if unavailable).</summary>
    public long? NetRxBytesPerSec { get; set; }

    /// <summary>Transmit rate on the primary interface in bytes/sec (nullable if unavailable).</summary>
    public long? NetTxBytesPerSec { get; set; }

    /// <summary>Ping target hostname/IP used for connectivity checks (nullable if disabled).</summary>
    [MaxLength(255)]
    public string? PingTarget { get; set; }

    /// <summary>Ping round-trip time in milliseconds (nullable if unavailable).</summary>
    public float? PingRttMs { get; set; }

    /// <summary>Ping packet loss percentage (0-100, nullable if unavailable).</summary>
    public float? PingPacketLossPercent { get; set; }

    // --- Agent process resource usage ---

    /// <summary>Agent process CPU usage percentage (0-100, nullable if unavailable).</summary>
    public float? AgentCpuPercent { get; set; }

    /// <summary>Agent process memory (working set) in bytes (nullable if unavailable).</summary>
    public long? AgentMemoryBytes { get; set; }

    /// <summary>Agent process GC heap size in bytes (nullable if unavailable).</summary>
    public long? AgentGcHeapBytes { get; set; }

    /// <summary>Agent process thread count (nullable if unavailable).</summary>
    public int? AgentThreadCount { get; set; }

    // Navigation property
    [ForeignKey(nameof(NodeId))]
    public Node Node { get; set; } = null!;
}
