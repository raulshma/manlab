namespace ManLab.Server.Services;

/// <summary>
/// Abstraction over HybridCache providing simplified caching operations with tag-based invalidation.
/// </summary>
public interface ICacheService
{
    /// <summary>
    /// Gets or creates a cache entry. Uses L1 (memory) and L2 (distributed) cache.
    /// </summary>
    /// <typeparam name="T">The type of data to cache.</typeparam>
    /// <param name="key">The cache key.</param>
    /// <param name="factory">Factory function to create the value if not cached.</param>
    /// <param name="expiration">Optional expiration time for distributed cache (L2). Defaults to 60 minutes.</param>
    /// <param name="localExpiration">Optional expiration time for local cache (L1). Defaults to 5 minutes.</param>
    /// <param name="tags">Optional tags for grouping and invalidation.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The cached or newly created value.</returns>
    ValueTask<T> GetOrCreateAsync<T>(
        string key,
        Func<CancellationToken, ValueTask<T>> factory,
        TimeSpan? expiration = null,
        TimeSpan? localExpiration = null,
        string[]? tags = null,
        CancellationToken ct = default);

    /// <summary>
    /// Sets a value in the cache.
    /// </summary>
    /// <typeparam name="T">The type of data to cache.</typeparam>
    /// <param name="key">The cache key.</param>
    /// <param name="value">The value to cache.</param>
    /// <param name="expiration">Optional expiration time for distributed cache (L2). Defaults to 60 minutes.</param>
    /// <param name="localExpiration">Optional expiration time for local cache (L1). Defaults to 5 minutes.</param>
    /// <param name="tags">Optional tags for grouping and invalidation.</param>
    /// <param name="ct">Cancellation token.</param>
    ValueTask SetAsync<T>(
        string key,
        T value,
        TimeSpan? expiration = null,
        TimeSpan? localExpiration = null,
        string[]? tags = null,
        CancellationToken ct = default);

    /// <summary>
    /// Removes a specific cache entry by key.
    /// </summary>
    /// <param name="key">The cache key to remove.</param>
    /// <param name="ct">Cancellation token.</param>
    ValueTask RemoveAsync(string key, CancellationToken ct = default);

    /// <summary>
    /// Removes all cache entries with the specified tag.
    /// </summary>
    /// <param name="tag">The tag to invalidate.</param>
    /// <param name="ct">Cancellation token.</param>
    ValueTask RemoveByTagAsync(string tag, CancellationToken ct = default);

    /// <summary>
    /// Removes all cache entries with any of the specified tags.
    /// </summary>
    /// <param name="tags">The tags to invalidate.</param>
    /// <param name="ct">Cancellation token.</param>
    ValueTask RemoveByTagsAsync(IEnumerable<string> tags, CancellationToken ct = default);
}
