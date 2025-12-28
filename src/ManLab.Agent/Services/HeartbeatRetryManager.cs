using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Services;

/// <summary>
/// Manages heartbeat retry logic with exponential backoff.
/// The backoff state can be reset when an admin-triggered ping succeeds.
/// Also tracks non-transient errors that should stop retrying after max attempts.
/// </summary>
public sealed class HeartbeatRetryManager
{
    /// <summary>
    /// Maximum retry attempts for non-transient errors before entering fatal error state.
    /// </summary>
    public const int MaxNonTransientRetries = 3;

    private readonly ILogger<HeartbeatRetryManager> _logger;
    private readonly object _lock = new();

    // Configuration
    private readonly int _maxDelaySeconds;
    private readonly int _baseDelaySeconds;

    // Backoff state
    private int _consecutiveFailures;
    private DateTime _nextRetryTime = DateTime.MinValue;

    // Fatal error state (for non-transient errors like 401, 403)
    private bool _isFatallyErrored;
    private int _nonTransientAttempts;
    private int? _errorCode;
    private string? _errorMessage;

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
    /// Returns true if the agent has encountered a non-transient error and exhausted retries.
    /// When true, the agent should stop attempting to connect until manually reset.
    /// </summary>
    public bool IsFatallyErrored
    {
        get
        {
            lock (_lock)
            {
                return _isFatallyErrored;
            }
        }
    }

    /// <summary>
    /// The error code for the fatal error (e.g., HTTP status code like 401).
    /// </summary>
    public int? ErrorCode
    {
        get
        {
            lock (_lock)
            {
                return _errorCode;
            }
        }
    }

    /// <summary>
    /// The error message for the fatal error.
    /// </summary>
    public string? ErrorMessage
    {
        get
        {
            lock (_lock)
            {
                return _errorMessage;
            }
        }
    }

    /// <summary>
    /// Gets the number of attempts made for the current non-transient error.
    /// </summary>
    public int NonTransientAttempts
    {
        get
        {
            lock (_lock)
            {
                return _nonTransientAttempts;
            }
        }
    }

    /// <summary>
    /// Returns true if a heartbeat should be attempted now based on backoff state.
    /// Returns false if fatally errored or still in backoff period.
    /// </summary>
    public bool ShouldAttemptHeartbeat()
    {
        lock (_lock)
        {
            if (_isFatallyErrored)
            {
                return false;
            }
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
            // Clear non-transient tracking on success
            _nonTransientAttempts = 0;
            _errorCode = null;
            _errorMessage = null;
            _isFatallyErrored = false;
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
    /// Records a non-transient failure (e.g., 401 Unauthorized, 403 Forbidden).
    /// After MaxNonTransientRetries attempts, marks the agent as fatally errored.
    /// Returns true if max retries exceeded and agent should stop trying.
    /// </summary>
    /// <param name="errorCode">HTTP status code or other error code.</param>
    /// <param name="message">Error message describing the failure.</param>
    /// <returns>True if max retries exceeded; false if should retry.</returns>
    public bool RecordNonTransientFailure(int errorCode, string message)
    {
        lock (_lock)
        {
            _nonTransientAttempts++;
            _errorCode = errorCode;
            _errorMessage = message;

            _logger.LogWarning(
                "Non-transient error (code: {ErrorCode}): {Message}. Attempt {Attempt}/{MaxAttempts}",
                errorCode, message, _nonTransientAttempts, MaxNonTransientRetries);

            if (_nonTransientAttempts >= MaxNonTransientRetries)
            {
                _isFatallyErrored = true;
                _logger.LogError(
                    "Max retries ({MaxRetries}) exceeded for non-transient error {ErrorCode}. " +
                    "Agent will stop retrying until manually reset. Error: {Message}",
                    MaxNonTransientRetries, errorCode, message);
                return true;
            }

            // Still have retries left - use exponential backoff
            RecordFailure();
            return false;
        }
    }

    /// <summary>
    /// Clears the fatal error state. Called when admin manually resets or fixes the issue.
    /// </summary>
    public void ClearFatalError()
    {
        lock (_lock)
        {
            if (_isFatallyErrored)
            {
                _logger.LogInformation(
                    "Fatal error state cleared. Previous error was: {ErrorCode} - {Message}",
                    _errorCode, _errorMessage);
            }
            _isFatallyErrored = false;
            _nonTransientAttempts = 0;
            _errorCode = null;
            _errorMessage = null;
        }
    }

    /// <summary>
    /// Resets the backoff state. Called when an admin-triggered ping succeeds.
    /// </summary>
    public void Reset()
    {
        lock (_lock)
        {
            if (_consecutiveFailures > 0 || _isFatallyErrored)
            {
                _logger.LogInformation("Heartbeat backoff reset by admin request");
            }
            _consecutiveFailures = 0;
            _nextRetryTime = DateTime.MinValue;
            // Also clear fatal error state on admin reset
            ClearFatalError();
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

    /// <summary>
    /// Gets the current error status for reporting to the server.
    /// </summary>
    public (bool isFatallyErrored, int? errorCode, string? errorMessage) GetErrorStatus()
    {
        lock (_lock)
        {
            return (_isFatallyErrored, _errorCode, _errorMessage);
        }
    }
}

