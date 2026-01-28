using Microsoft.Extensions.Caching.Memory;
using System.Collections.Concurrent;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Configuration options for network scanning rate limiting.
/// </summary>
public class NetworkRateLimitOptions
{
    public const string SectionName = "NetworkRateLimit";

    /// <summary>
    /// Maximum number of concurrent subnet scans per connection.
    /// </summary>
    public int MaxConcurrentScans { get; set; } = 1;

    /// <summary>
    /// Maximum requests per minute for ping operations.
    /// </summary>
    public int PingRequestsPerMinute { get; set; } = 60;

    /// <summary>
    /// Maximum requests per minute for traceroute operations.
    /// </summary>
    public int TracerouteRequestsPerMinute { get; set; } = 20;

    /// <summary>
    /// Maximum requests per minute for port scan operations.
    /// </summary>
    public int PortScanRequestsPerMinute { get; set; } = 10;

    /// <summary>
    /// Maximum requests per minute for subnet scan operations.
    /// </summary>
    public int SubnetScanRequestsPerMinute { get; set; } = 5;

    /// <summary>
    /// Maximum requests per minute for device discovery operations.
    /// </summary>
    public int DiscoveryRequestsPerMinute { get; set; } = 10;

    /// <summary>
    /// Maximum requests per minute for speed test operations.
    /// </summary>
    public int SpeedTestRequestsPerMinute { get; set; } = 5;
}

/// <summary>
/// Rate limiter for network scanning operations.
/// Uses sliding window algorithm to prevent abuse.
/// </summary>
public sealed class NetworkRateLimitService
{
    private readonly IMemoryCache _cache;
    private readonly NetworkRateLimitOptions _options;
    private readonly ConcurrentDictionary<string, int> _activeScans = new();

    public NetworkRateLimitService(IMemoryCache cache, Microsoft.Extensions.Options.IOptions<NetworkRateLimitOptions> options)
    {
        _cache = cache;
        _options = options?.Value ?? new NetworkRateLimitOptions();
    }

    /// <summary>
    /// Checks if the operation is rate limited and throws if so.
    /// </summary>
    /// <param name="connectionId">The SignalR connection ID.</param>
    /// <param name="operation">The operation type (ping, traceroute, portscan, subnet, discovery).</param>
    /// <exception cref="InvalidOperationException">If rate limit is exceeded.</exception>
    public void ThrowIfRateLimited(string connectionId, string operation)
    {
        var (isLimited, retryAfterSeconds) = CheckRateLimit(connectionId, operation);
        if (isLimited)
        {
            throw new InvalidOperationException(
                $"Rate limit exceeded for {operation}. Please wait {retryAfterSeconds} seconds before retrying.");
        }
    }

    /// <summary>
    /// Checks if an operation would exceed rate limits.
    /// </summary>
    /// <param name="connectionId">The SignalR connection ID.</param>
    /// <param name="operation">The operation type.</param>
    /// <returns>Tuple of (isLimited, retryAfterSeconds).</returns>
    public (bool IsLimited, int RetryAfterSeconds) CheckRateLimit(string connectionId, string operation)
    {
        var limit = GetLimitForOperation(operation);
        var windowKey = GetWindowKey(connectionId, operation);

        var requestCount = _cache.GetOrCreate(windowKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(1);
            return 0;
        });

        if (requestCount >= limit)
        {
            // Calculate retry after based on when the cache entry expires
            return (true, 60);
        }

        return (false, 0);
    }

    /// <summary>
    /// Records a request for rate limiting purposes.
    /// </summary>
    /// <param name="connectionId">The SignalR connection ID.</param>
    /// <param name="operation">The operation type.</param>
    public void RecordRequest(string connectionId, string operation)
    {
        var windowKey = GetWindowKey(connectionId, operation);

        var count = _cache.GetOrCreate(windowKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(1);
            return 0;
        });

        _cache.Set(windowKey, count + 1, TimeSpan.FromMinutes(1));
    }

    /// <summary>
    /// Checks if the connection can start a new scan (enforces concurrent scan limit).
    /// </summary>
    /// <param name="connectionId">The SignalR connection ID.</param>
    /// <returns>True if a new scan can start.</returns>
    public bool TryStartScan(string connectionId)
    {
        var currentScans = _activeScans.AddOrUpdate(
            connectionId,
            1,
            (_, existing) => existing + 1);

        if (currentScans > _options.MaxConcurrentScans)
        {
            _activeScans.AddOrUpdate(connectionId, 0, (_, existing) => Math.Max(0, existing - 1));
            return false;
        }

        return true;
    }

    /// <summary>
    /// Marks a scan as completed.
    /// </summary>
    /// <param name="connectionId">The SignalR connection ID.</param>
    public void EndScan(string connectionId)
    {
        if (_activeScans.ContainsKey(connectionId))
        {
            _activeScans.AddOrUpdate(connectionId, 0, (_, existing) => Math.Max(0, existing - 1));
        }
    }

    /// <summary>
    /// Checks if a connection is currently active (connected).
    /// </summary>
    public bool IsConnectionActive(string connectionId)
    {
        return _activeScans.ContainsKey(connectionId);
    }

    /// <summary>
    /// Cleans up tracking for a disconnected connection.
    /// </summary>
    /// <param name="connectionId">The SignalR connection ID.</param>
    public void CleanupConnection(string connectionId)
    {
        _activeScans.TryRemove(connectionId, out _);
    }

    private int GetLimitForOperation(string operation) => operation.ToLowerInvariant() switch
    {
        "ping" => _options.PingRequestsPerMinute,
        "traceroute" => _options.TracerouteRequestsPerMinute,
        "portscan" => _options.PortScanRequestsPerMinute,
        "subnet" => _options.SubnetScanRequestsPerMinute,
        "discovery" => _options.DiscoveryRequestsPerMinute,
        "speedtest" => _options.SpeedTestRequestsPerMinute,
        _ => 30 // Default limit
    };

    private static string GetWindowKey(string connectionId, string operation)
        => $"network:ratelimit:{connectionId}:{operation}";
}
