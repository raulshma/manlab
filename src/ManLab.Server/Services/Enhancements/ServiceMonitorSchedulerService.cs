using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// Periodically queues <c>service.status</c> commands for nodes that have enabled service monitors.
///
/// This turns "service monitoring" into an actual monitoring loop (rather than a one-off manual refresh).
///
/// Safeguards:
/// - Only queues for Online nodes
/// - Won't queue if a ServiceStatus command is already pending recently
/// - Won't queue if snapshots are already fresh
/// </summary>
public sealed class ServiceMonitorSchedulerService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromSeconds(30);

    // If we have a snapshot newer than this, don't enqueue another refresh.
    private static readonly TimeSpan MinSnapshotAge = TimeSpan.FromSeconds(60);

    // Prevent spamming commands if dispatch is slow or agent is busy.
    private static readonly TimeSpan PendingCommandCooldown = TimeSpan.FromSeconds(60);

    private readonly ILogger<ServiceMonitorSchedulerService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;

    public ServiceMonitorSchedulerService(
        ILogger<ServiceMonitorSchedulerService> logger,
        IServiceScopeFactory scopeFactory)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("ServiceMonitorSchedulerService started. Interval={Interval}s", Interval.TotalSeconds);

        // Small initial delay so migrations and other hosted services settle.
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
                await TickAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Service monitor scheduler tick failed");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("ServiceMonitorSchedulerService stopped");
    }

    private async Task TickAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;

        // Find nodes with any enabled service monitors.
        var nodeIds = await db.ServiceMonitorConfigs
            .AsNoTracking()
            .Where(c => c.Enabled)
            .Select(c => c.NodeId)
            .Distinct()
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        if (nodeIds.Count == 0)
        {
            return;
        }

        var enqueued = 0;

        foreach (var nodeId in nodeIds)
        {
            // Only monitor online nodes.
            var isOnline = await db.Nodes
                .AsNoTracking()
                .AnyAsync(n => n.Id == nodeId && n.Status == NodeStatus.Online, cancellationToken)
                .ConfigureAwait(false);

            if (!isOnline)
            {
                continue;
            }

            // Avoid duplicate pending service.status commands.
            var hasRecentPending = await db.CommandQueue
                .AsNoTracking()
                .Where(c => c.NodeId == nodeId)
                .Where(c => c.CommandType == CommandType.ServiceStatus)
                .Where(c => c.Status == CommandStatus.Queued || c.Status == CommandStatus.Sent || c.Status == CommandStatus.InProgress)
                .Where(c => c.CreatedAt > now - PendingCommandCooldown)
                .AnyAsync(cancellationToken)
                .ConfigureAwait(false);

            if (hasRecentPending)
            {
                continue;
            }

            // If the newest snapshot is fresh, skip.
            var latestSnapshot = await db.ServiceStatusSnapshots
                .AsNoTracking()
                .Where(s => s.NodeId == nodeId)
                .MaxAsync(s => (DateTime?)s.Timestamp, cancellationToken)
                .ConfigureAwait(false);

            if (latestSnapshot.HasValue && latestSnapshot.Value > now - MinSnapshotAge)
            {
                continue;
            }

            var services = await db.ServiceMonitorConfigs
                .AsNoTracking()
                .Where(c => c.NodeId == nodeId && c.Enabled)
                .OrderBy(c => c.ServiceName)
                .Select(c => c.ServiceName)
                .ToListAsync(cancellationToken)
                .ConfigureAwait(false);

            if (services.Count == 0)
            {
                continue;
            }

            var payload = JsonSerializer.Serialize(new { services });

            db.CommandQueue.Add(new CommandQueueItem
            {
                Id = Guid.NewGuid(),
                NodeId = nodeId,
                CommandType = CommandType.ServiceStatus,
                Payload = payload,
                Status = CommandStatus.Queued,
                CreatedAt = now
            });

            enqueued++;
        }

        if (enqueued > 0)
        {
            await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
            _logger.LogDebug("Service monitor scheduler enqueued {Count} service.status commands", enqueued);
        }
    }
}
