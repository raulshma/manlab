namespace ManLab.Server.Services.Retention;

/// <summary>
/// Retention configuration for time-series snapshot tables.
/// </summary>
public sealed class RetentionOptions
{
    public const string SectionName = "Retention";

    /// <summary>
    /// How long to keep high-frequency telemetry snapshots.
    /// </summary>
    public int TelemetrySnapshotDays { get; set; } = 30;

    /// <summary>
    /// How long to keep service status snapshots.
    /// </summary>
    public int ServiceStatusSnapshotDays { get; set; } = 30;

    /// <summary>
    /// How long to keep SMART drive snapshots.
    /// </summary>
    public int SmartDriveSnapshotDays { get; set; } = 30;

    /// <summary>
    /// How long to keep GPU snapshots.
    /// </summary>
    public int GpuSnapshotDays { get; set; } = 30;

    /// <summary>
    /// How long to keep UPS snapshots.
    /// </summary>
    public int UpsSnapshotDays { get; set; } = 30;

    /// <summary>
    /// Background cleanup interval in minutes.
    /// </summary>
    public int CleanupIntervalMinutes { get; set; } = 60;
}
