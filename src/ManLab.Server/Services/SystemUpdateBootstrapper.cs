namespace ManLab.Server.Services;

/// <summary>
/// Bootstraps the system update job scheduler at application startup.
/// </summary>
public sealed class SystemUpdateBootstrapper : IHostedService
{
    private readonly SystemUpdateScheduler _scheduler;
    private readonly ILogger<SystemUpdateBootstrapper> _logger;

    public SystemUpdateBootstrapper(
        SystemUpdateScheduler scheduler,
        ILogger<SystemUpdateBootstrapper> logger)
    {
        _scheduler = scheduler;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            await _scheduler.ScheduleGlobalSystemUpdateJobAsync(cancellationToken)
                .ConfigureAwait(false);
            _logger.LogInformation("System update bootstrapper started successfully");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to start system update bootstrapper");
            throw;
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
