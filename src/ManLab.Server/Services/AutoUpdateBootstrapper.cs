using ManLab.Server.Constants;

namespace ManLab.Server.Services;

/// <summary>
/// Bootstraps the auto-update job scheduler at application startup.
/// </summary>
public sealed class AutoUpdateBootstrapper : IHostedService
{
    private readonly AutoUpdateScheduler _scheduler;
    private readonly ISettingsService _settings;
    private readonly ILogger<AutoUpdateBootstrapper> _logger;

    public AutoUpdateBootstrapper(
        AutoUpdateScheduler scheduler,
        ISettingsService settings,
        ILogger<AutoUpdateBootstrapper> logger)
    {
        _scheduler = scheduler;
        _settings = settings;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            // Check if job is enabled (default: true)
            var enabled = await _settings.GetValueAsync(SettingKeys.AutoUpdate.JobEnabled, "true");
            if (enabled.Equals("false", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogInformation("Auto-update job is disabled, skipping scheduling");
                return;
            }

            // Get custom schedule if configured
            var customSchedule = await _settings.GetValueAsync(SettingKeys.AutoUpdate.JobSchedule);

            await _scheduler.ScheduleGlobalAutoUpdateJobAsync(customSchedule, cancellationToken)
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
