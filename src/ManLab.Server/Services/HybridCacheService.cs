using Microsoft.Extensions.Caching.Hybrid;

namespace ManLab.Server.Services;

/// <summary>
/// Implementation of ICacheService using HybridCache with L1 (memory) and L2 (distributed) caching.
/// </summary>
public sealed class HybridCacheService : ICacheService
{
    private readonly HybridCache _cache;
    private readonly ILogger<HybridCacheService> _logger;

    private static readonly TimeSpan DefaultExpiration = TimeSpan.FromMinutes(60);
    private static readonly TimeSpan DefaultLocalExpiration = TimeSpan.FromMinutes(5);

    public HybridCacheService(HybridCache cache, ILogger<HybridCacheService> logger)
    {
        _cache = cache;
        _logger = logger;
    }

    public ValueTask<T> GetOrCreateAsync<T>(
        string key,
        Func<CancellationToken, ValueTask<T>> factory,
        TimeSpan? expiration = null,
        TimeSpan? localExpiration = null,
        string[]? tags = null,
        CancellationToken ct = default)
    {
        var options = new HybridCacheEntryOptions
        {
            Expiration = expiration ?? DefaultExpiration,
            LocalCacheExpiration = localExpiration ?? DefaultLocalExpiration
        };

        return _cache.GetOrCreateAsync(
            key,
            factory,
            options,
            tags,
            ct);
    }

    public ValueTask SetAsync<T>(
        string key,
        T value,
        TimeSpan? expiration = null,
        TimeSpan? localExpiration = null,
        string[]? tags = null,
        CancellationToken ct = default)
    {
        var options = new HybridCacheEntryOptions
        {
            Expiration = expiration ?? DefaultExpiration,
            LocalCacheExpiration = localExpiration ?? DefaultLocalExpiration
        };

        return _cache.SetAsync(key, value, options, tags, ct);
    }

    public ValueTask RemoveAsync(string key, CancellationToken ct = default)
    {
        _logger.LogDebug("Removing cache entry with key: {CacheKey}", key);
        return _cache.RemoveAsync(key, ct);
    }

    public ValueTask RemoveByTagAsync(string tag, CancellationToken ct = default)
    {
        _logger.LogDebug("Removing cache entries with tag: {CacheTag}", tag);
        return _cache.RemoveByTagAsync(tag, ct);
    }

    public ValueTask RemoveByTagsAsync(IEnumerable<string> tags, CancellationToken ct = default)
    {
        _logger.LogDebug("Removing cache entries with tags: {CacheTags}", string.Join(", ", tags));
        return _cache.RemoveByTagAsync(tags, ct);
    }
}
