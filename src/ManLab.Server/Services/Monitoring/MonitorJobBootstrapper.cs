using ManLab.Server.Data;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// Loads existing monitor configs and schedules Quartz jobs at startup.
/// </summary>
public sealed class MonitorJobBootstrapper : IHostedService
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly MonitorJobScheduler _scheduler;
    private readonly ILogger<MonitorJobBootstrapper> _logger;

    public MonitorJobBootstrapper(
        IServiceScopeFactory scopeFactory,
        MonitorJobScheduler scheduler,
        ILogger<MonitorJobBootstrapper> logger)
    {
        _scopeFactory = scopeFactory;
        _scheduler = scheduler;
        _logger = logger;
    }

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var httpConfigs = await db.HttpMonitorConfigs
            .AsNoTracking()
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var config in httpConfigs)
        {
            try
            {
                await _scheduler.ApplyHttpMonitorScheduleAsync(config, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to schedule HTTP monitor {MonitorId}", config.Id);
            }
        }

        var trafficConfigs = await db.TrafficMonitorConfigs
            .AsNoTracking()
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var config in trafficConfigs)
        {
            try
            {
                await _scheduler.ApplyTrafficMonitorScheduleAsync(config, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to schedule traffic monitor {MonitorId}", config.Id);
            }
        }

        var scheduledTools = await db.ScheduledNetworkToolConfigs
            .AsNoTracking()
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        foreach (var config in scheduledTools)
        {
            try
            {
                await _scheduler.ApplyScheduledToolScheduleAsync(config, cancellationToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to schedule network tool {ScheduleId}", config.Id);
            }
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}
