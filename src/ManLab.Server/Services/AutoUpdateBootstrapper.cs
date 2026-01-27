namespace ManLab.Server.Services;

/// <summary>
/// Bootstraps the auto-update job scheduler at application startup.
/// </summary>
public sealed class AutoUpdateBootstrapper : IHostedService
{
    private readonly AutoUpdateScheduler _scheduler;
    private readonly ILogger<AutoUpdateBootstrapper> _logger;

    public AutoUpdateBootstrapper(
        AutoUpdateScheduler scheduler,
        ILogger<AutoUpdateBootstrapper> logger)
    {
        _scheduler = scheduler;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _scheduler.ScheduleGlobalAutoUpdateJobAsync(cancellationToken)
                .ConfigureAwait(false);
            _logger.LogInformation("Auto-update bootstrapper started successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start auto-update bootstrapper");
            throw;
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
