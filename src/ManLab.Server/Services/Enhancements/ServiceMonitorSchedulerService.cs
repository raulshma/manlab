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

    /// <summary>
    /// DTO to hold all needed monitoring data per node, fetched in batch.
    /// </summary>
    private sealed record NodeMonitorData(
        Guid NodeId,
        DateTime? LatestSnapshot,
        bool HasRecentPending,
        List<string> ServiceNames
    );

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

    /// <summary>
    /// Fetches all monitoring data in 3-4 batch queries instead of 4N per-node queries.
    /// Reduces database roundtrips from O(4N) to O(1).
    /// </summary>
    private async Task<List<NodeMonitorData>> GetMonitorDataAsync(
        DataContext db,
        List<Guid> nodeIds,
        CancellationToken ct)
    {
        var now = DateTime.UtcNow;

        // Query 1: Get online nodes from the candidate set
        var onlineNodes = await db.Nodes
            .AsNoTracking()
            .Where(n => nodeIds.Contains(n.Id) && n.Status == NodeStatus.Online)
            .Select(n => n.Id)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        if (onlineNodes.Count == 0)
            return [];

        // Query 2: Get latest snapshot timestamp per online node
        var latestSnapshots = await db.ServiceStatusSnapshots
            .AsNoTracking()
            .Where(s => onlineNodes.Contains(s.NodeId))
            .GroupBy(s => s.NodeId)
            .Select(g => new { NodeId = g.Key, LatestTimestamp = g.Max(s => s.Timestamp) })
            .ToListAsync(ct)
            .ConfigureAwait(false);

        // Query 3: Get nodes with recent pending service.status commands
        var recentPendingNodes = await db.CommandQueue
            .AsNoTracking()
            .Where(c => onlineNodes.Contains(c.NodeId))
            .Where(c => c.CommandType == CommandType.ServiceStatus)
            .Where(c => c.Status == CommandStatus.Queued || c.Status == CommandStatus.Sent || c.Status == CommandStatus.InProgress)
            .Where(c => c.CreatedAt > now - PendingCommandCooldown)
            .Select(c => c.NodeId)
            .Distinct()
            .ToListAsync(ct)
            .ConfigureAwait(false);

        // Query 4: Get service monitor configs for online nodes
        var serviceConfigs = await db.ServiceMonitorConfigs
            .AsNoTracking()
            .Where(c => onlineNodes.Contains(c.NodeId) && c.Enabled)
            .OrderBy(c => c.NodeId)
            .ThenBy(c => c.ServiceName)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        // Assemble in memory
        var latestSnapshotDict = latestSnapshots.ToDictionary(x => x.NodeId, x => (DateTime?)x.LatestTimestamp);
        var hasPendingSet = recentPendingNodes.ToHashSet();
        var servicesByNode = serviceConfigs.GroupBy(c => c.NodeId)
            .ToDictionary(g => g.Key, g => g.Select(c => c.ServiceName).ToList());

        return onlineNodes.Select(nodeId =>
        {
            var hasPending = hasPendingSet.Contains(nodeId);
            var latest = latestSnapshotDict.TryGetValue(nodeId, out var ts) ? ts : null;
            var services = servicesByNode.TryGetValue(nodeId, out var svcList) ? svcList : [];

            return new NodeMonitorData(nodeId, latest, hasPending, services);
        }).ToList();
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

        // BATCH fetch all necessary data in 3-4 queries (O(1) instead of O(4N))
        var monitorDataList = await GetMonitorDataAsync(db, nodeIds, cancellationToken);

        var enqueued = 0;

        foreach (var data in monitorDataList)
        {
            // Skip if recent pending command exists
            if (data.HasRecentPending)
                continue;

            // Skip if snapshot is still fresh
            if (data.LatestSnapshot.HasValue && data.LatestSnapshot.Value > now - MinSnapshotAge)
                continue;

            // Skip if no services configured
            if (data.ServiceNames.Count == 0)
                continue;

            var payload = JsonSerializer.Serialize(new { services = data.ServiceNames });

            db.CommandQueue.Add(new CommandQueueItem
            {
                Id = Guid.NewGuid(),
                NodeId = data.NodeId,
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
