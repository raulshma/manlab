namespace ManLab.Server.Services.Persistence;

/// <summary>
/// Configuration options for SignalR scaling and backplane.
/// </summary>
public class SignalROptions
{
    public const string SectionName = "SignalR";

    /// <summary>
    /// Enables Redis backplane for horizontal scaling across multiple server instances.
    /// When enabled, all servers must share the same Redis instance.
    /// </summary>
    public bool EnableRedisBackplane { get; set; }

    /// <summary>
    /// Channel prefix for Redis messages to avoid conflicts with other applications.
    /// </summary>
    public string RedisChannelPrefix { get; set; } = "ManLab";

    /// <summary>
    /// Redis connection string for the backplane.
    /// If not provided, uses the same Redis as distributed cache.
    /// </summary>
    public string? RedisConnectionString { get; set; }
}
