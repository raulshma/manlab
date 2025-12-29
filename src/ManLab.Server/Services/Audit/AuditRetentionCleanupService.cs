using ManLab.Server.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Audit;

/// <summary>
/// Periodic cleanup job for server audit/activity events.
/// </summary>
public sealed class AuditRetentionCleanupService : BackgroundService
{
    private readonly ILogger<AuditRetentionCleanupService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptionsMonitor<AuditOptions> _options;

    public AuditRetentionCleanupService(
        ILogger<AuditRetentionCleanupService> logger,
        IServiceScopeFactory scopeFactory,
        IOptionsMonitor<AuditOptions> options)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _options = options;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Delay slightly so migrations complete.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(8), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CleanupOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Audit retention cleanup failed");
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
        if (!_options.CurrentValue.Enabled)
        {
            return;
        }

        var retentionDays = Math.Max(1, _options.CurrentValue.RetentionDays);
        var cutoff = DateTime.UtcNow.AddDays(-retentionDays);

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var deleted = await db.AuditEvents
            .Where(e => e.TimestampUtc < cutoff)
            .ExecuteDeleteAsync(cancellationToken)
            .ConfigureAwait(false);

        if (deleted > 0)
        {
            _logger.LogInformation("Audit retention deleted {Deleted} rows older than {Cutoff:O}", deleted, cutoff);
        }
    }
}
