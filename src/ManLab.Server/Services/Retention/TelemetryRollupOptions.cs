namespace ManLab.Server.Services.Retention;

/// <summary>
/// Options for telemetry rollup aggregation.
/// </summary>
public sealed class TelemetryRollupOptions
{
    public const string SectionName = "TelemetryRollup";

    /// <summary>
    /// How many days of raw telemetry to backfill when no rollups exist.
    /// </summary>
    public int InitialBackfillDays { get; set; } = 7;

    /// <summary>
    /// Background rollup interval in minutes.
    /// </summary>
    public int RollupIntervalMinutes { get; set; } = 10;
}
