using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Services;

/// <summary>
/// Manages heartbeat retry logic with exponential backoff.
/// The backoff state can be reset when an admin-triggered ping succeeds.
/// </summary>
public sealed class HeartbeatRetryManager
{
    private readonly ILogger<HeartbeatRetryManager> _logger;
    private readonly object _lock = new();

    // Configuration
    private readonly int _maxDelaySeconds;
    private readonly int _baseDelaySeconds;

    // State
    private int _consecutiveFailures;
    private DateTime _nextRetryTime = DateTime.MinValue;

    public HeartbeatRetryManager(
        ILogger<HeartbeatRetryManager> logger,
        int baseDelaySeconds = 2,
        int maxDelaySeconds = 300)
    {
        _logger = logger;
        _baseDelaySeconds = baseDelaySeconds;
        _maxDelaySeconds = maxDelaySeconds;
    }

    /// <summary>
    /// Gets the next scheduled retry time (UTC). Returns null if not in backoff.
    /// </summary>
    public DateTime? NextRetryTimeUtc
    {
        get
        {
            lock (_lock)
            {
                return _consecutiveFailures > 0 ? _nextRetryTime : null;
            }
        }
    }

    /// <summary>
    /// Gets the current consecutive failure count.
    /// </summary>
    public int ConsecutiveFailures
    {
        get
        {
            lock (_lock)
            {
                return _consecutiveFailures;
            }
        }
    }

    /// <summary>
    /// Returns true if a heartbeat should be attempted now based on backoff state.
    /// </summary>
    public bool ShouldAttemptHeartbeat()
    {
        lock (_lock)
        {
            return DateTime.UtcNow >= _nextRetryTime;
        }
    }

    /// <summary>
    /// Records a successful heartbeat, resetting the backoff state.
    /// </summary>
    public void RecordSuccess()
    {
        lock (_lock)
        {
            if (_consecutiveFailures > 0)
            {
                _logger.LogInformation(
                    "Heartbeat succeeded, resetting backoff (was at {Failures} consecutive failures)",
                    _consecutiveFailures);
            }
            _consecutiveFailures = 0;
            _nextRetryTime = DateTime.MinValue;
        }
    }

    /// <summary>
    /// Records a failed heartbeat, increasing the backoff delay.
    /// Returns the next retry time.
    /// </summary>
    public DateTime RecordFailure()
    {
        lock (_lock)
        {
            _consecutiveFailures++;

            // Exponential backoff: 2s, 4s, 8s, 16s, ... up to max
            var delaySeconds = Math.Min(
                _baseDelaySeconds * Math.Pow(2, _consecutiveFailures - 1),
                _maxDelaySeconds);

            // Add jitter (±10%) to prevent thundering herd
            var jitter = Random.Shared.NextDouble() * 0.2 - 0.1;
            delaySeconds *= (1 + jitter);

            _nextRetryTime = DateTime.UtcNow.AddSeconds(delaySeconds);

            _logger.LogWarning(
                "Heartbeat failed (consecutive: {Failures}), next attempt at {NextRetry:O} (in {Delay:F1}s)",
                _consecutiveFailures,
                _nextRetryTime,
                delaySeconds);

            return _nextRetryTime;
        }
    }

    /// <summary>
    /// Resets the backoff state. Called when an admin-triggered ping succeeds.
    /// </summary>
    public void Reset()
    {
        lock (_lock)
        {
            if (_consecutiveFailures > 0)
            {
                _logger.LogInformation("Heartbeat backoff reset by admin request");
            }
            _consecutiveFailures = 0;
            _nextRetryTime = DateTime.MinValue;
        }
    }

    /// <summary>
    /// Gets the current backoff status for reporting to the server.
    /// </summary>
    public (int consecutiveFailures, DateTime? nextRetryTimeUtc) GetStatus()
    {
        lock (_lock)
        {
            return (_consecutiveFailures, _consecutiveFailures > 0 ? _nextRetryTime : null);
        }
    }
}
