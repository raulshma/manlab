using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Aggregated telemetry rollup bucket.
/// </summary>
[Table("TelemetryRollups")]
public class TelemetryRollup
{
    [Key]
    public long Id { get; set; }

    public Guid NodeId { get; set; }

    public TelemetryRollupGranularity Granularity { get; set; }

    /// <summary>Bucket start time (UTC).</summary>
    public DateTime BucketStartUtc { get; set; }

    /// <summary>Bucket duration in seconds (e.g., 3600 or 86400).</summary>
    public int BucketSeconds { get; set; }

    /// <summary>Number of raw samples aggregated into this rollup.</summary>
    public int SampleCount { get; set; }

    // CPU
    public float? CpuAvg { get; set; }
    public float? CpuMin { get; set; }
    public float? CpuMax { get; set; }
    public float? CpuP95 { get; set; }

    // RAM
    public float? RamAvg { get; set; }
    public float? RamMin { get; set; }
    public float? RamMax { get; set; }
    public float? RamP95 { get; set; }

    // Disk
    public float? DiskAvg { get; set; }
    public float? DiskMin { get; set; }
    public float? DiskMax { get; set; }
    public float? DiskP95 { get; set; }

    // Temperature
    public float? TempAvg { get; set; }
    public float? TempMin { get; set; }
    public float? TempMax { get; set; }
    public float? TempP95 { get; set; }

    // Network
    public double? NetRxAvg { get; set; }
    public double? NetRxMax { get; set; }
    public double? NetRxP95 { get; set; }

    public double? NetTxAvg { get; set; }
    public double? NetTxMax { get; set; }
    public double? NetTxP95 { get; set; }

    // Ping
    public float? PingRttAvg { get; set; }
    public float? PingRttMax { get; set; }
    public float? PingRttP95 { get; set; }

    public float? PingLossAvg { get; set; }
    public float? PingLossMax { get; set; }
    public float? PingLossP95 { get; set; }
}
