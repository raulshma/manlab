using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Ssh;

/// <summary>
/// Lightweight in-memory lockout mechanism for repeated SSH failures.
/// This is not a general-purpose rate limiter; it is meant to reduce brute force attempts.
/// </summary>
public sealed class SshRateLimitService
{
    private readonly IMemoryCache _cache;
    private readonly SshProvisioningOptions _options;

    public SshRateLimitService(IMemoryCache cache, IOptions<SshProvisioningOptions> options)
    {
        _cache = cache;
        _options = options.Value;
    }

    public (bool IsLockedOut, DateTimeOffset? Until, int FailureCount) GetLockoutState(string key)
    {
        if (_cache.TryGetValue<LockoutState>(GetLockoutKey(key), out var state) && state is not null)
        {
            if (state.LockedUntilUtc is not null && state.LockedUntilUtc > DateTimeOffset.UtcNow)
            {
                return (true, state.LockedUntilUtc, state.Failures);
            }

            return (false, null, state.Failures);
        }

        return (false, null, 0);
    }

    public void ThrowIfLockedOut(string key)
    {
        var (locked, until, _) = GetLockoutState(key);
        if (locked)
        {
            throw new InvalidOperationException($"SSH operations temporarily locked out due to repeated failures. Retry after {until:O}.");
        }
    }

    public void RecordSuccess(string key)
    {
        // Reset failure state on success.
        _cache.Remove(GetLockoutKey(key));
    }

    public void RecordFailure(string key)
    {
        var cacheKey = GetLockoutKey(key);

        var state = _cache.GetOrCreate(cacheKey, entry =>
        {
            entry.AbsoluteExpirationRelativeToNow = _options.FailureWindow;
            return new LockoutState();
        })!;

        state.Failures++;

        if (state.Failures >= _options.MaxFailuresBeforeLockout)
        {
            state.LockedUntilUtc = DateTimeOffset.UtcNow.Add(_options.LockoutDuration);
            // Keep state around at least until lockout ends.
            _cache.Set(cacheKey, state, state.LockedUntilUtc.Value);
        }
        else
        {
            // Extend within window.
            _cache.Set(cacheKey, state, _options.FailureWindow);
        }
    }

    private static string GetLockoutKey(string key) => $"ssh:lockout:{key}";

    private sealed class LockoutState
    {
        public int Failures { get; set; }
        public DateTimeOffset? LockedUntilUtc { get; set; }
    }
}
