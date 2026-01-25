using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Retention;

/// <summary>
/// Periodic cleanup job for snapshot tables.
/// </summary>
public sealed class RetentionCleanupService : BackgroundService
{
    private readonly ILogger<RetentionCleanupService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptionsMonitor<RetentionOptions> _options;

    public RetentionCleanupService(
        ILogger<RetentionCleanupService> logger,
        IServiceScopeFactory scopeFactory,
        IOptionsMonitor<RetentionOptions> options)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _options = options;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Small initial delay so startup migrations can complete.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CleanupOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Retention cleanup failed");
            }

            var interval = TimeSpan.FromMinutes(Math.Max(5, _options.CurrentValue.CleanupIntervalMinutes));
            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task CleanupOnceAsync(CancellationToken cancellationToken)
    {
        var opts = _options.CurrentValue;

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;

        var telemetryCutoff = now.AddDays(-Math.Max(1, opts.TelemetrySnapshotDays));
        var hourlyRollupCutoff = now.AddDays(-Math.Max(1, opts.TelemetryRollupHourlyDays));
        var dailyRollupCutoff = now.AddDays(-Math.Max(1, opts.TelemetryRollupDailyDays));
        var serviceCutoff = now.AddDays(-Math.Max(1, opts.ServiceStatusSnapshotDays));
        var smartCutoff = now.AddDays(-Math.Max(1, opts.SmartDriveSnapshotDays));
        var gpuCutoff = now.AddDays(-Math.Max(1, opts.GpuSnapshotDays));
        var upsCutoff = now.AddDays(-Math.Max(1, opts.UpsSnapshotDays));

        // Use ExecuteDelete for efficient server-side deletes.
        var telemetryDeleted = await db.TelemetrySnapshots
            .Where(t => t.Timestamp < telemetryCutoff)
            .ExecuteDeleteAsync(cancellationToken);

        var hourlyDeleted = await db.TelemetryRollups
            .Where(r => r.Granularity == Data.Enums.TelemetryRollupGranularity.Hour && r.BucketStartUtc < hourlyRollupCutoff)
            .ExecuteDeleteAsync(cancellationToken);

        var dailyDeleted = await db.TelemetryRollups
            .Where(r => r.Granularity == Data.Enums.TelemetryRollupGranularity.Day && r.BucketStartUtc < dailyRollupCutoff)
            .ExecuteDeleteAsync(cancellationToken);

        var serviceDeleted = await db.ServiceStatusSnapshots
            .Where(s => s.Timestamp < serviceCutoff)
            .ExecuteDeleteAsync(cancellationToken);

        var smartDeleted = await db.SmartDriveSnapshots
            .Where(s => s.Timestamp < smartCutoff)
            .ExecuteDeleteAsync(cancellationToken);

        var gpuDeleted = await db.GpuSnapshots
            .Where(s => s.Timestamp < gpuCutoff)
            .ExecuteDeleteAsync(cancellationToken);

        var upsDeleted = await db.UpsSnapshots
            .Where(s => s.Timestamp < upsCutoff)
            .ExecuteDeleteAsync(cancellationToken);

        if (telemetryDeleted + hourlyDeleted + dailyDeleted + serviceDeleted + smartDeleted + gpuDeleted + upsDeleted > 0)
        {
            _logger.LogInformation(
            "Retention cleanup deleted rows: Telemetry={Telemetry} HourlyRollups={Hourly} DailyRollups={Daily} Service={Service} SMART={Smart} GPU={Gpu} UPS={Ups}",
                telemetryDeleted,
            hourlyDeleted,
            dailyDeleted,
                serviceDeleted,
                smartDeleted,
                gpuDeleted,
                upsDeleted);
        }
    }
}
