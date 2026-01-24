namespace ManLab.Server.Services.Network;

/// <summary>
/// Service for running server-side internet speed tests.
/// </summary>
public interface ISpeedTestService
{
    /// <summary>
    /// Runs a speed test with the provided request parameters.
    /// </summary>
    Task<SpeedTestResult> RunAsync(
        SpeedTestRequest request,
        CancellationToken ct = default,
        Action<SpeedTestProgressUpdate>? onProgress = null);
}
