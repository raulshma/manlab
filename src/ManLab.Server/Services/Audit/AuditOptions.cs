namespace ManLab.Server.Services.Audit;

/// <summary>
/// Configuration for server-side activity/audit logging.
/// </summary>
public sealed class AuditOptions
{
    public const string SectionName = "Audit";

    /// <summary>
    /// Master switch for audit persistence.
    /// When disabled, events are dropped at enqueue time.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Maximum number of events buffered in-memory.
    /// When full, new events are dropped to protect server health.
    /// </summary>
    public int QueueCapacity { get; set; } = 5_000;

    /// <summary>
    /// Batch size for DB writes.
    /// </summary>
    public int MaxBatchSize { get; set; } = 250;

    /// <summary>
    /// Maximum time to wait before flushing a partial batch.
    /// </summary>
    public int FlushIntervalMilliseconds { get; set; } = 1_000;

    /// <summary>
    /// Maximum UTF-8 size allowed for DataJson.
    /// When exceeded, data is replaced with a small truncation marker.
    /// </summary>
    public int MaxDataJsonBytesUtf8 { get; set; } = 4_096;

    /// <summary>
    /// Number of days to retain audit/activity events.
    /// </summary>
    public int RetentionDays { get; set; } = 30;

    /// <summary>
    /// Cleanup interval in minutes.
    /// </summary>
    public int CleanupIntervalMinutes { get; set; } = 60;
}
