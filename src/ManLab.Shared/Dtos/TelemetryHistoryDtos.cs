namespace ManLab.Shared.Dtos;

/// <summary>
/// Aggregated telemetry history response.
/// </summary>
public sealed class TelemetryHistoryResponse
{
    /// <summary>Requested start time (UTC).</summary>
    public DateTime FromUtc { get; set; }

    /// <summary>Requested end time (UTC).</summary>
    public DateTime ToUtc { get; set; }

    /// <summary>Granularity used for the response (raw/hour/day).</summary>
    public string Granularity { get; set; } = "raw";

    /// <summary>Bucket size in seconds.</summary>
    public int BucketSeconds { get; set; }

    /// <summary>Series points.</summary>
    public List<TelemetryHistoryPoint> Points { get; set; } = [];
}

/// <summary>
/// Telemetry history point with rollup statistics.
/// </summary>
public sealed class TelemetryHistoryPoint
{
    public DateTime Timestamp { get; set; }
    public int SampleCount { get; set; }

    public float? CpuAvg { get; set; }
    public float? CpuMin { get; set; }
    public float? CpuMax { get; set; }
    public float? CpuP95 { get; set; }

    public float? RamAvg { get; set; }
    public float? RamMin { get; set; }
    public float? RamMax { get; set; }
    public float? RamP95 { get; set; }

    public float? DiskAvg { get; set; }
    public float? DiskMin { get; set; }
    public float? DiskMax { get; set; }
    public float? DiskP95 { get; set; }

    public float? TempAvg { get; set; }
    public float? TempMin { get; set; }
    public float? TempMax { get; set; }
    public float? TempP95 { get; set; }

    public double? NetRxAvg { get; set; }
    public double? NetRxMax { get; set; }
    public double? NetRxP95 { get; set; }

    public double? NetTxAvg { get; set; }
    public double? NetTxMax { get; set; }
    public double? NetTxP95 { get; set; }

    public float? PingRttAvg { get; set; }
    public float? PingRttMax { get; set; }
    public float? PingRttP95 { get; set; }

    public float? PingLossAvg { get; set; }
    public float? PingLossMax { get; set; }
    public float? PingLossP95 { get; set; }
}
