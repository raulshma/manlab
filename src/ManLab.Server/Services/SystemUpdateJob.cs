using ManLab.Server.Constants;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using Microsoft.EntityFrameworkCore;
using Quartz;
using ManLab.Server.Services.SystemUpdate;

namespace ManLab.Server.Services;

/// <summary>
/// Quartz job that periodically checks for available system updates.
/// </summary>
[DisallowConcurrentExecution]
public sealed class SystemUpdateJob : IJob
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly SystemUpdateService _systemUpdateService;
    private readonly ILogger<SystemUpdateJob> _logger;

    public SystemUpdateJob(
        IServiceScopeFactory scopeFactory,
        SystemUpdateService systemUpdateService,
        ILogger<SystemUpdateJob> logger)
    {
        _scopeFactory = scopeFactory;
        _systemUpdateService = systemUpdateService;
        _logger = logger;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        _logger.LogDebug("System update job started at {Time}", DateTime.UtcNow);

        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var db = scope.ServiceProvider.GetRequiredService<DataContext>();

            // Get all nodes with system update enabled
            var nodesWithSystemUpdate = await db.Nodes
                .AsNoTracking()
                .Join(
                    db.NodeSettings.Where(s => s.Key == SettingKeys.SystemUpdate.Enabled && s.Value == "true"),
                    node => node.Id,
                    setting => setting.NodeId,
                    (node, _) => node)
                .Where(n => n.Status == NodeStatus.Online)
                .ToListAsync(context.CancellationToken);

            _logger.LogDebug("System update check: {Count} online nodes with system update enabled", nodesWithSystemUpdate.Count);

            foreach (var node in nodesWithSystemUpdate)
            {
                try
                {
                    await ProcessNodeSystemUpdateAsync(db, node, context.CancellationToken);
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "Failed to process system update for node {NodeId}", node.Id);
                }
            }

            _logger.LogDebug("System update job completed at {Time}", DateTime.UtcNow);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "System update job failed at {Time}", DateTime.UtcNow);
            throw;
        }
    }

    /// <summary>
    /// Processes system update for a single node.
    /// </summary>
    private async Task ProcessNodeSystemUpdateAsync(DataContext db, Node node, CancellationToken cancellationToken)
    {
        var settings = await _systemUpdateService.GetNodeSettingsAsync(node.Id, cancellationToken);
        if (!settings.Enabled)
        {
            return;
        }

        // Check if we've recently checked (min interval protection)
        var lastCheckAtStr = await GetNodeSettingValueAsync(db, node.Id, SettingKeys.SystemUpdate.LastCheckAt, cancellationToken);
        if (DateTime.TryParse(lastCheckAtStr, out var lastCheckAt))
        {
            var timeSinceLastCheck = DateTime.UtcNow - lastCheckAt;
            if (timeSinceLastCheck.TotalMinutes < settings.CheckIntervalMinutes)
            {
                _logger.LogDebug("Node {NodeId} was checked recently, skipping to avoid excessive checks", node.Id);
                return;
            }
        }

        // Check if within maintenance window
        if (!IsWithinMaintenanceWindow(settings.MaintenanceWindow))
        {
            _logger.LogDebug("Node {NodeId} is outside maintenance window, skipping system update check", node.Id);
            return;
        }

        // Check for available updates
        var availability = await _systemUpdateService.CheckForUpdatesAsync(node.Id, cancellationToken);
        if (availability == null || !availability.HasUpdates)
        {
            _logger.LogDebug("Node {NodeId} has no available system updates", node.Id);
            return;
        }

        _logger.LogInformation("System updates available for node {NodeId}: {Count} package(s), {Security} security update(s)",
            node.Id, availability.Packages.Count, availability.SecurityUpdates);

        // Filter based on settings
        var includePackages = availability.Packages.Where(p =>
            (settings.IncludeSecurityUpdates && p.Type == "security") ||
            (settings.IncludeFeatureUpdates && p.Type == "feature") ||
            (settings.IncludeDriverUpdates && p.Type == "driver") ||
            p.Type == "other").ToList();

        if (includePackages.Count == 0)
        {
            _logger.LogDebug("Node {NodeId} has no matching updates based on current settings", node.Id);
            return;
        }

        // Create pending update (will auto-approve if settings allow)
        var options = new SystemUpdateOptions
        {
            IncludeSecurityUpdates = settings.IncludeSecurityUpdates,
            IncludeFeatureUpdates = settings.IncludeFeatureUpdates,
            IncludeDriverUpdates = settings.IncludeDriverUpdates
        };

        var updateId = await _systemUpdateService.CreatePendingUpdateAsync(node.Id, options, cancellationToken);

        if (updateId.HasValue)
        {
            _logger.LogInformation("Created system update {UpdateId} for node {NodeId}", updateId.Value, node.Id);
        }
    }

    /// <summary>
    /// Checks if current time is within the maintenance window.
    /// </summary>
    private static bool IsWithinMaintenanceWindow(string? maintenanceWindow)
    {
        if (string.IsNullOrWhiteSpace(maintenanceWindow))
        {
            return true; // No window specified = always allow
        }

        // Expected format: "HH:MM-HH:MM" in UTC
        var parts = maintenanceWindow.Split('-');
        if (parts.Length != 2)
        {
            return true; // Invalid format = always allow
        }

        if (!TimeSpan.TryParse(parts[0], out var start) ||
            !TimeSpan.TryParse(parts[1], out var end))
        {
            return true; // Invalid format = always allow
        }

        var now = DateTime.UtcNow.TimeOfDay;

        // Handle window that crosses midnight
        if (end < start)
        {
            return now >= start || now <= end;
        }

        return now >= start && now <= end;
    }

    /// <summary>
    /// Gets a node setting value.
    /// </summary>
    private async Task<string?> GetNodeSettingValueAsync(DataContext db, Guid nodeId, string key, CancellationToken cancellationToken = default)
    {
        var setting = await db.NodeSettings.FindAsync(new object[] { nodeId, key }, cancellationToken);
        return setting?.Value;
    }
}
