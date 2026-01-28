using ManLab.Server.Constants;
using Microsoft.Extensions.DependencyInjection;

namespace ManLab.Server.Services;

/// <summary>
/// Bootstraps the system update job scheduler at application startup.
/// </summary>
public sealed class SystemUpdateBootstrapper : IHostedService
{
    private readonly SystemUpdateScheduler _scheduler;
    private readonly ISettingsService _settings;
    private readonly ILogger<SystemUpdateBootstrapper> _logger;

    public SystemUpdateBootstrapper(
        SystemUpdateScheduler scheduler,
        ISettingsService settings,
        ILogger<SystemUpdateBootstrapper> logger,
        IServiceScopeFactory scopeFactory)
    {
        _scheduler = scheduler;
        _settings = settings;
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    private readonly IServiceScopeFactory _scopeFactory;

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        try
        {
            // Clean up any stuck updates from previous runs
            using (var scope = _scopeFactory.CreateScope())
            {
                var systemUpdateService = scope.ServiceProvider.GetRequiredService<SystemUpdateService>();
                await systemUpdateService.CleanupStuckUpdatesAsync(cancellationToken);
            }

            // Check if job is enabled (default: true)
            var enabled = await _settings.GetValueAsync(SettingKeys.SystemUpdate.JobEnabled, "true");
            if (enabled.Equals("false", StringComparison.OrdinalIgnoreCase))
            {
                _logger.LogInformation("System update job is disabled, skipping scheduling");
                return;
            }

            // Get custom schedule if configured
            var customSchedule = await _settings.GetValueAsync(SettingKeys.SystemUpdate.JobSchedule);

            await _scheduler.ScheduleGlobalSystemUpdateJobAsync(customSchedule, cancellationToken)
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
