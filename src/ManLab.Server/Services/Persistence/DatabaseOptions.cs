namespace ManLab.Server.Services.Persistence;

/// <summary>
/// Configuration options for database behavior including read replica routing.
/// </summary>
public class DatabaseOptions
{
    public const string SectionName = "Database";

    /// <summary>
    /// Enables automatic routing of read queries to a read replica when available.
    /// Write operations and transactions always use the primary database.
    /// </summary>
    public bool EnableReadReplicaRouting { get; set; }

    /// <summary>
    /// Probability (0.0 to 1.0) that a read query will be routed to the replica.
    /// Useful for gradual rollout or A/B testing (e.g., 0.8 = 80% to replica).
    /// </summary>
    public double ReplicaReadProbability { get; set; } = 0.8;

    /// <summary>
    /// Connection resiliency settings for transient failures.
    /// </summary>
    public ConnectionResiliencyOptions ConnectionResiliency { get; set; } = new();
}

/// <summary>
/// Options for handling transient database failures.
/// </summary>
public class ConnectionResiliencyOptions
{
    /// <summary>
    /// Maximum number of retry attempts for transient failures.
    /// </summary>
    public int MaxRetryCount { get; set; } = 3;

    /// <summary>
    /// Maximum delay between retries in seconds.
    /// </summary>
    public int MaxRetryDelaySeconds { get; set; } = 30;

    /// <summary>
    /// Enable detailed errors in EF Core (development only).
    /// </summary>
    public bool EnableDetailedErrors { get; set; } = false;
}
