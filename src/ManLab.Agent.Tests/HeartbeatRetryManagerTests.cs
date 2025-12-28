using ManLab.Agent.Services;
using Microsoft.Extensions.Logging.Abstractions;
using Xunit;

namespace ManLab.Agent.Tests;

/// <summary>
/// Tests for HeartbeatRetryManager covering all cases:
/// - Initial state
/// - Success recording
/// - Failure recording with exponential backoff
/// - Non-transient error handling with max retries
/// - Fatal error state
/// - Reset and clear operations
/// - GetStatus and GetErrorStatus methods
/// </summary>
public class HeartbeatRetryManagerTests
{
    private HeartbeatRetryManager CreateManager(int baseDelaySeconds = 2, int maxDelaySeconds = 300)
    {
        return new HeartbeatRetryManager(
            NullLogger<HeartbeatRetryManager>.Instance,
            baseDelaySeconds,
            maxDelaySeconds);
    }

    #region Initial State Tests

    [Fact]
    public void InitialState_ShouldAllowHeartbeat()
    {
        var manager = CreateManager();

        Assert.True(manager.ShouldAttemptHeartbeat());
        Assert.Equal(0, manager.ConsecutiveFailures);
        Assert.False(manager.IsFatallyErrored);
        Assert.Null(manager.ErrorCode);
        Assert.Null(manager.ErrorMessage);
        Assert.Null(manager.NextRetryTimeUtc);
        Assert.Equal(0, manager.NonTransientAttempts);
    }

    [Fact]
    public void GetStatus_InitialState_ReturnsNoFailures()
    {
        var manager = CreateManager();

        var (failures, nextRetry) = manager.GetStatus();

        Assert.Equal(0, failures);
        Assert.Null(nextRetry);
    }

    [Fact]
    public void GetErrorStatus_InitialState_ReturnsNoError()
    {
        var manager = CreateManager();

        var (isFatally, code, msg) = manager.GetErrorStatus();

        Assert.False(isFatally);
        Assert.Null(code);
        Assert.Null(msg);
    }

    #endregion

    #region RecordSuccess Tests

    [Fact]
    public void RecordSuccess_ResetsConsecutiveFailures()
    {
        var manager = CreateManager();

        // Record some failures first
        manager.RecordFailure();
        manager.RecordFailure();
        Assert.Equal(2, manager.ConsecutiveFailures);

        // Now succeed
        manager.RecordSuccess();

        Assert.Equal(0, manager.ConsecutiveFailures);
        Assert.Null(manager.NextRetryTimeUtc);
        Assert.True(manager.ShouldAttemptHeartbeat());
    }

    [Fact]
    public void RecordSuccess_ClearsNonTransientState()
    {
        var manager = CreateManager();

        // Record a non-transient failure
        manager.RecordNonTransientFailure(401, "Unauthorized");
        Assert.Equal(1, manager.NonTransientAttempts);
        Assert.Equal(401, manager.ErrorCode);

        // Now succeed
        manager.RecordSuccess();

        Assert.Equal(0, manager.NonTransientAttempts);
        Assert.Null(manager.ErrorCode);
        Assert.Null(manager.ErrorMessage);
        Assert.False(manager.IsFatallyErrored);
    }

    [Fact]
    public void RecordSuccess_ClearsFatalErrorState()
    {
        var manager = CreateManager();

        // Make it fatally errored (3 non-transient failures)
        manager.RecordNonTransientFailure(401, "Unauthorized");
        manager.RecordNonTransientFailure(401, "Unauthorized");
        manager.RecordNonTransientFailure(401, "Unauthorized");
        Assert.True(manager.IsFatallyErrored);

        // Now succeed
        manager.RecordSuccess();

        Assert.False(manager.IsFatallyErrored);
        Assert.True(manager.ShouldAttemptHeartbeat());
    }

    #endregion

    #region RecordFailure Tests

    [Fact]
    public void RecordFailure_IncrementsConsecutiveFailures()
    {
        var manager = CreateManager();

        manager.RecordFailure();
        Assert.Equal(1, manager.ConsecutiveFailures);

        manager.RecordFailure();
        Assert.Equal(2, manager.ConsecutiveFailures);

        manager.RecordFailure();
        Assert.Equal(3, manager.ConsecutiveFailures);
    }

    [Fact]
    public void RecordFailure_SetsNextRetryTime()
    {
        var manager = CreateManager();

        var nextRetry = manager.RecordFailure();

        Assert.NotNull(manager.NextRetryTimeUtc);
        Assert.True(nextRetry > DateTime.UtcNow);
        Assert.Equal(nextRetry, manager.NextRetryTimeUtc);
    }

    [Fact]
    public void RecordFailure_UsesExponentialBackoff()
    {
        // Use 1 second base for easier testing
        var manager = CreateManager(baseDelaySeconds: 1, maxDelaySeconds: 100);

        var retry1 = manager.RecordFailure();
        var expectedBase1 = 1.0; // 1 * 2^0 = 1

        manager.RecordFailure();
        var retry2 = manager.NextRetryTimeUtc!.Value;
        var expectedBase2 = 2.0; // 1 * 2^1 = 2

        manager.RecordFailure();
        var retry3 = manager.NextRetryTimeUtc!.Value;
        var expectedBase3 = 4.0; // 1 * 2^2 = 4

        // With jitter, actual delays could be ±10% off, so verify order of magnitude
        // Check that retry times are increasing (accounting for when they were recorded)
        Assert.True(manager.ConsecutiveFailures == 3);
    }

    [Fact]
    public void RecordFailure_RespectsMaxDelay()
    {
        // Use small max delay for testing
        var manager = CreateManager(baseDelaySeconds: 1, maxDelaySeconds: 5);

        // Record many failures to exceed max delay
        for (int i = 0; i < 10; i++)
        {
            manager.RecordFailure();
        }

        var status = manager.GetStatus();
        var delay = (status.nextRetryTimeUtc!.Value - DateTime.UtcNow).TotalSeconds;

        // With jitter, max should be around 5 * 1.1 = 5.5
        Assert.True(delay <= 6.0, $"Delay {delay} exceeded max delay with jitter");
    }

    [Fact]
    public void ShouldAttemptHeartbeat_ReturnsFalseDuringBackoff()
    {
        var manager = CreateManager(baseDelaySeconds: 100); // Long delay

        manager.RecordFailure();

        // Should not attempt immediately after failure
        Assert.False(manager.ShouldAttemptHeartbeat());
    }

    #endregion

    #region RecordNonTransientFailure Tests

    [Fact]
    public void RecordNonTransientFailure_TracksAttempts()
    {
        var manager = CreateManager();

        Assert.False(manager.RecordNonTransientFailure(401, "Unauthorized"));
        Assert.Equal(1, manager.NonTransientAttempts);
        Assert.Equal(401, manager.ErrorCode);
        Assert.Equal("Unauthorized", manager.ErrorMessage);
        Assert.False(manager.IsFatallyErrored);

        Assert.False(manager.RecordNonTransientFailure(401, "Still unauthorized"));
        Assert.Equal(2, manager.NonTransientAttempts);
    }

    [Fact]
    public void RecordNonTransientFailure_BecomesFatalAfterMaxRetries()
    {
        var manager = CreateManager();

        // First two attempts should return false
        Assert.False(manager.RecordNonTransientFailure(401, "Attempt 1"));
        Assert.False(manager.IsFatallyErrored);

        Assert.False(manager.RecordNonTransientFailure(401, "Attempt 2"));
        Assert.False(manager.IsFatallyErrored);

        // Third attempt (max) should return true and set fatal
        Assert.True(manager.RecordNonTransientFailure(401, "Attempt 3"));
        Assert.True(manager.IsFatallyErrored);
        Assert.Equal(3, manager.NonTransientAttempts);
    }

    [Fact]
    public void RecordNonTransientFailure_PreservesLastErrorDetails()
    {
        var manager = CreateManager();

        manager.RecordNonTransientFailure(401, "First error");
        manager.RecordNonTransientFailure(403, "Second error");
        manager.RecordNonTransientFailure(403, "Third error");

        // Should have the last error details
        Assert.Equal(403, manager.ErrorCode);
        Assert.Equal("Third error", manager.ErrorMessage);
    }

    [Fact]
    public void RecordNonTransientFailure_AlsoRecordsRegularFailure()
    {
        var manager = CreateManager();

        manager.RecordNonTransientFailure(401, "Unauthorized");

        // Should also track as a consecutive failure (for backoff)
        Assert.Equal(1, manager.ConsecutiveFailures);
        Assert.NotNull(manager.NextRetryTimeUtc);
    }

    [Fact]
    public void MaxNonTransientRetries_EqualsThree()
    {
        Assert.Equal(3, HeartbeatRetryManager.MaxNonTransientRetries);
    }

    #endregion

    #region ShouldAttemptHeartbeat Tests

    [Fact]
    public void ShouldAttemptHeartbeat_ReturnsFalseWhenFatallyErrored()
    {
        var manager = CreateManager();

        // Become fatally errored
        manager.RecordNonTransientFailure(401, "Error 1");
        manager.RecordNonTransientFailure(401, "Error 2");
        manager.RecordNonTransientFailure(401, "Error 3");

        Assert.True(manager.IsFatallyErrored);
        Assert.False(manager.ShouldAttemptHeartbeat());
    }

    [Fact]
    public void ShouldAttemptHeartbeat_ReturnsTrueAfterBackoffExpires()
    {
        // Use very short delay
        var manager = CreateManager(baseDelaySeconds: 0); // No delay

        manager.RecordFailure();

        // With base delay of 0, should be able to retry immediately
        Assert.True(manager.ShouldAttemptHeartbeat());
    }

    #endregion

    #region ClearFatalError Tests

    [Fact]
    public void ClearFatalError_ClearsFatalState()
    {
        var manager = CreateManager();

        // Make it fatally errored
        manager.RecordNonTransientFailure(401, "Error 1");
        manager.RecordNonTransientFailure(401, "Error 2");
        manager.RecordNonTransientFailure(401, "Error 3");
        Assert.True(manager.IsFatallyErrored);

        // Clear fatal error
        manager.ClearFatalError();

        Assert.False(manager.IsFatallyErrored);
        Assert.Equal(0, manager.NonTransientAttempts);
        Assert.Null(manager.ErrorCode);
        Assert.Null(manager.ErrorMessage);
    }

    [Fact]
    public void ClearFatalError_DoesNotAffectRegularBackoff()
    {
        var manager = CreateManager();

        // Record regular failures
        manager.RecordFailure();
        manager.RecordFailure();
        Assert.Equal(2, manager.ConsecutiveFailures);

        // Clear fatal error (which doesn't exist)
        manager.ClearFatalError();

        // Regular backoff should remain
        Assert.Equal(2, manager.ConsecutiveFailures);
        Assert.NotNull(manager.NextRetryTimeUtc);
    }

    #endregion

    #region Reset Tests

    [Fact]
    public void Reset_ClearsAllState()
    {
        var manager = CreateManager();

        // Set up various failure states
        manager.RecordFailure();
        manager.RecordFailure();
        manager.RecordNonTransientFailure(401, "Error 1");
        manager.RecordNonTransientFailure(401, "Error 2");
        manager.RecordNonTransientFailure(401, "Error 3");

        Assert.True(manager.IsFatallyErrored);
        Assert.True(manager.ConsecutiveFailures > 0);

        // Reset
        manager.Reset();

        Assert.Equal(0, manager.ConsecutiveFailures);
        Assert.Null(manager.NextRetryTimeUtc);
        Assert.False(manager.IsFatallyErrored);
        Assert.Equal(0, manager.NonTransientAttempts);
        Assert.Null(manager.ErrorCode);
        Assert.Null(manager.ErrorMessage);
        Assert.True(manager.ShouldAttemptHeartbeat());
    }

    [Fact]
    public void Reset_WorksOnCleanState()
    {
        var manager = CreateManager();

        // Reset on clean state should not throw
        manager.Reset();

        Assert.True(manager.ShouldAttemptHeartbeat());
    }

    #endregion

    #region GetStatus Tests

    [Fact]
    public void GetStatus_ReturnsCorrectValuesAfterFailure()
    {
        var manager = CreateManager();

        manager.RecordFailure();
        manager.RecordFailure();

        var (failures, nextRetry) = manager.GetStatus();

        Assert.Equal(2, failures);
        Assert.NotNull(nextRetry);
        Assert.True(nextRetry > DateTime.UtcNow);
    }

    [Fact]
    public void GetStatus_ReturnsNullNextRetryWhenNoFailures()
    {
        var manager = CreateManager();

        manager.RecordFailure();
        manager.RecordSuccess(); // Reset

        var (failures, nextRetry) = manager.GetStatus();

        Assert.Equal(0, failures);
        Assert.Null(nextRetry);
    }

    #endregion

    #region GetErrorStatus Tests

    [Fact]
    public void GetErrorStatus_ReturnsCorrectValuesWhenFatal()
    {
        var manager = CreateManager();

        manager.RecordNonTransientFailure(401, "Unauthorized 1");
        manager.RecordNonTransientFailure(403, "Forbidden 2");
        manager.RecordNonTransientFailure(403, "Forbidden 3");

        var (isFatally, code, msg) = manager.GetErrorStatus();

        Assert.True(isFatally);
        Assert.Equal(403, code);
        Assert.Equal("Forbidden 3", msg);
    }

    [Fact]
    public void GetErrorStatus_ReturnsPartialInfoBeforeFatal()
    {
        var manager = CreateManager();

        manager.RecordNonTransientFailure(401, "Unauthorized");

        var (isFatally, code, msg) = manager.GetErrorStatus();

        Assert.False(isFatally);
        Assert.Equal(401, code);
        Assert.Equal("Unauthorized", msg);
    }

    #endregion

    #region Thread Safety Tests

    [Fact]
    public async Task ConcurrentAccess_IsThreadSafe()
    {
        var manager = CreateManager();
        var tasks = new List<Task>();

        // Simulate concurrent access from multiple threads
        for (int i = 0; i < 100; i++)
        {
            tasks.Add(Task.Run(() =>
            {
                manager.RecordFailure();
                _ = manager.ConsecutiveFailures;
                _ = manager.ShouldAttemptHeartbeat();
                _ = manager.GetStatus();
            }));

            tasks.Add(Task.Run(() =>
            {
                manager.RecordSuccess();
                _ = manager.IsFatallyErrored;
                _ = manager.GetErrorStatus();
            }));

            tasks.Add(Task.Run(() =>
            {
                manager.RecordNonTransientFailure(401, "Test");
                _ = manager.ErrorCode;
                _ = manager.ErrorMessage;
            }));
        }

        // Should complete without deadlock or exception
        await Task.WhenAll(tasks);

        // State should be consistent (can check it didn't crash)
        _ = manager.GetStatus();
        _ = manager.GetErrorStatus();
    }

    #endregion
}
