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

    // Navigation property
    [ForeignKey(nameof(NodeId))]
    public Node Node { get; set; } = null!;
}
