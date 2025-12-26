using ManLab.Server.Data;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services;

/// <summary>
/// Background worker that monitors agent heartbeats and marks nodes Offline
/// if they have not reported within the configured threshold.
/// </summary>
public sealed class HealthMonitorService : BackgroundService
{
    private static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan OfflineThreshold = TimeSpan.FromMinutes(2);

    private readonly ILogger<HealthMonitorService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IHubContext<AgentHub> _hubContext;
    private readonly INotificationService _notificationService;

    public HealthMonitorService(
        ILogger<HealthMonitorService> logger,
        IServiceScopeFactory scopeFactory,
        IHubContext<AgentHub> hubContext,
        INotificationService notificationService)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _hubContext = hubContext;
        _notificationService = notificationService;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("HealthMonitorService started. Interval={IntervalSeconds}s Threshold={ThresholdSeconds}s",
            CheckInterval.TotalSeconds,
            OfflineThreshold.TotalSeconds);

        // Small initial delay so the host can fully start up.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CheckOfflineNodesAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                // Normal shutdown.
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Health monitor loop failed");
            }

            try
            {
                await Task.Delay(CheckInterval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }

        _logger.LogInformation("HealthMonitorService stopped");
    }

    private async Task CheckOfflineNodesAsync(CancellationToken cancellationToken)
    {
        var cutoff = DateTime.UtcNow.Subtract(OfflineThreshold);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Only flip nodes that are currently Online and have been silent past the cutoff.
        // Maintenance nodes are intentionally excluded.
        var nodesToFlip = await dbContext.Nodes
            .Where(n => n.Status == NodeStatus.Online && n.LastSeen < cutoff)
            .ToListAsync(cancellationToken);

        if (nodesToFlip.Count == 0)
        {
            return;
        }

        foreach (var node in nodesToFlip)
        {
            node.Status = NodeStatus.Offline;
        }

        await dbContext.SaveChangesAsync(cancellationToken);

        foreach (var node in nodesToFlip)
        {
            _logger.LogWarning("Node marked Offline due to missed heartbeats: {NodeId} ({Hostname}) LastSeen={LastSeen:o}",
                node.Id,
                node.Hostname,
                node.LastSeen);

            // Notify connected dashboard clients.
            await _hubContext.Clients.All.SendAsync(
                "NodeStatusChanged",
                node.Id,
                node.Status.ToString(),
                node.LastSeen,
                cancellationToken);

            await _notificationService.NotifyNodeOfflineAsync(node, cancellationToken);
        }
    }
}
