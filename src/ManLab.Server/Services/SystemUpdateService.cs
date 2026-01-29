using ManLab.Server.Constants;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Ssh;
using ManLab.Server.Services.SystemUpdate;
using ManLab.Server.Services.Security;
using ManLab.Server.Hubs;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Services;

/// <summary>
/// Service for managing system updates on nodes.
/// </summary>
public sealed class SystemUpdateService
{
    private const int MaxFailureCount = 5;
    private const int MinCheckIntervalMinutes = 30;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<SystemUpdateService> _logger;
    private readonly IAuditLog _audit;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly SshProvisioningService _sshProvisioningService;
    private readonly IHubContext<AgentHub> _hubContext;

    public SystemUpdateService(
        IServiceScopeFactory scopeFactory,
        ILogger<SystemUpdateService> logger,
        IAuditLog audit,
        IHttpContextAccessor httpContextAccessor,
        SshProvisioningService sshProvisioningService,
        IHubContext<AgentHub> hubContext)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _audit = audit;
        _httpContextAccessor = httpContextAccessor;
        _sshProvisioningService = sshProvisioningService;
        _hubContext = hubContext;
    }

    #region Core Update Methods

    /// <summary>
    /// Checks all nodes with system update enabled and creates pending updates if available.
    /// This method is called by the scheduled Quartz job or when manually triggered.
    /// </summary>
    public async Task CheckAndCreatePendingUpdatesAsync(bool force = false, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("System update job starting (Force: {Force})", force);

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
            .ToListAsync(cancellationToken);

        _logger.LogInformation("System update check: {Count} online nodes with system update enabled (Force: {Force})", nodesWithSystemUpdate.Count, force);

        // Create history entry for manual triggers even if no nodes to process
        if (force)
        {
            _logger.LogInformation("Creating history entry for manual trigger");
            await CreateHistoryEntryForManualTriggerAsync(db, nodesWithSystemUpdate.Count, cancellationToken);
            _logger.LogInformation("History entry created successfully");
        }

        if (nodesWithSystemUpdate.Count == 0)
        {
            _logger.LogInformation("No nodes with system update enabled found");
            return;
        }

        foreach (var node in nodesWithSystemUpdate)
        {
            try
            {
                await ProcessNodeSystemUpdateAsync(db, node, force, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to process system update for node {NodeId}", node.Id);
            }
        }
    }

    /// <summary>
    /// Processes system update for a single node.
    /// </summary>
    private async Task ProcessNodeSystemUpdateAsync(DataContext db, Node node, bool force, CancellationToken cancellationToken)
    {
        var settings = await GetNodeSettingsAsync(db, node.Id, cancellationToken);
        if (!settings.Enabled && !force)
        {
            return;
        }

        // Check if we've recently checked (min interval protection) (skip if forced)
        var lastCheckAtStr = await GetNodeSettingValueAsync(db, node.Id, SettingKeys.SystemUpdate.LastCheckAt, cancellationToken);
        if (!force && DateTime.TryParse(lastCheckAtStr, out var lastCheckAt))
        {
            var timeSinceLastCheck = DateTime.UtcNow - lastCheckAt;
            if (timeSinceLastCheck.TotalMinutes < MinCheckIntervalMinutes)
            {
                _logger.LogDebug("Node {NodeId} was checked recently, skipping to avoid excessive checks", node.Id);
                return;
            }
        }

        // Check if within maintenance window (skip if forced)
        if (!force && !IsWithinMaintenanceWindow(settings.MaintenanceWindow))
        {
            _logger.LogDebug("Node {NodeId} is outside maintenance window, skipping system update check", node.Id);
            return;
        }

        // Check for available updates
        var availability = await CheckForUpdatesAsync(node.Id, cancellationToken);
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

        var updateId = await CreatePendingUpdateAsync(node.Id, options, cancellationToken);

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
    /// Creates a history entry for manual trigger.
    /// </summary>
    private async Task CreateHistoryEntryForManualTriggerAsync(DataContext db, int nodeCount, CancellationToken cancellationToken)
    {
        try
        {
            using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

            var history = new SystemUpdateHistory
            {
                Id = Guid.NewGuid(),
                NodeId = Guid.Empty,
                StartedAt = DateTime.UtcNow,
                CompletedAt = DateTime.UtcNow,
                Status = "Completed",
                PackagesJson = null
            };

            db.SystemUpdateHistories.Add(history);
            var rowsSaved = await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            _logger.LogInformation("Created system update history entry {HistoryId}: Checked {Count} nodes (saved {Rows} row(s))",
                history.Id, nodeCount, rowsSaved);

            // Also create an audit entry for visibility
            await CreateAuditEntryDirectlyAsync(db, "systemupdate.check",
                $"Manual trigger completed. Checked {nodeCount} online nodes with system update enabled.", cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create history entry for manual trigger");
            throw;
        }
    }

    /// <summary>
    /// Records an audit event directly to the database (synchronous, bypasses queue).
    /// Used for manual triggers to ensure immediate visibility in history.
    /// </summary>
    private async Task CreateAuditEntryDirectlyAsync(DataContext db, string eventName, string message, CancellationToken cancellationToken = default)
    {
        try
        {
            using var transaction = await db.Database.BeginTransactionAsync(cancellationToken);

            var auditEvent = new AuditEvent
            {
                Id = Guid.NewGuid(),
                Kind = "activity",
                EventName = eventName,
                Category = "system-update",
                Source = "system",
                ActorType = "system",
                NodeId = Guid.Empty,
                Success = true,
                Message = message,
                TimestampUtc = DateTime.UtcNow
            };

            db.AuditEvents.Add(auditEvent);
            var rowsSaved = await db.SaveChangesAsync(cancellationToken);
            await transaction.CommitAsync(cancellationToken);

            _logger.LogInformation("Created audit entry {AuditId}: {EventName} - {Message} (saved {Rows} row(s))",
                auditEvent.Id, eventName, message, rowsSaved);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create audit entry: {EventName} - {Message}", eventName, message);
            throw;
        }
    }

    /// <summary>
    /// Checks a node for available system updates.
    /// </summary>
    public async Task<SystemUpdateAvailability?> CheckForUpdatesAsync(
        Guid nodeId,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var node = await db.Nodes
            .AsNoTracking()
            .FirstOrDefaultAsync(n => n.Id == nodeId, cancellationToken);

        if (node == null)
        {
            _logger.LogWarning("Node {NodeId} not found for system update check", nodeId);
            return null;
        }

        // Get linked onboarding machine for SSH access
        var machine = await db.OnboardingMachines
            .FirstOrDefaultAsync(m => m.LinkedNodeId == node.Id, cancellationToken);

        if (machine == null)
        {
            _logger.LogWarning("No SSH credentials available for node {NodeId}", nodeId);
            return null;
        }

        var settings = await GetNodeSettingsAsync(db, nodeId, cancellationToken);
        var osType = DetermineOsType(node);
        var packageManager = settings.PackageManager ?? DeterminePackageManager(osType);

        try
        {
            var options = await CreateSshConnectionOptionsAsync(machine, cancellationToken);
            var checkCommand = PlatformCommandBuilder.BuildCheckCommand(osType, packageManager);
            var output = await _sshProvisioningService.ExecuteCommandAsync(options, checkCommand, cancellationToken);

            var packages = PlatformCommandBuilder.ParseUpdateList(output, osType);
            var securityCount = packages.Count(p => p.Type == "security");

            // Check if reboot is required from previous updates
            var rebootCheckCommand = PlatformCommandBuilder.BuildRebootCheckCommand(osType, packageManager);
            var rebootOutput = await _sshProvisioningService.ExecuteCommandAsync(options, rebootCheckCommand, cancellationToken);
            var rebootRequired = rebootOutput.Contains("REBOOT_REQUIRED", StringComparison.OrdinalIgnoreCase);

            // Update last check time
            await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.LastCheckAt, DateTime.UtcNow.ToString("o"), cancellationToken);

            return new SystemUpdateAvailability
            {
                HasUpdates = packages.Count > 0,
                Packages = packages,
                SecurityUpdates = securityCount,
                RebootRequired = rebootRequired,
                CheckedAt = DateTime.UtcNow
            };
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to check for updates on node {NodeId}", nodeId);
            await RecordFailureAsync(db, nodeId, ex.Message, cancellationToken);
            return null;
        }
    }

    /// <summary>
    /// Creates a pending system update record.
    /// </summary>
    public async Task<Guid?> CreatePendingUpdateAsync(
        Guid nodeId,
        SystemUpdateOptions options,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var node = await db.Nodes
            .AsNoTracking()
            .FirstOrDefaultAsync(n => n.Id == nodeId, cancellationToken);

        if (node == null)
        {
            return null;
        }

        // Check for available updates
        var availability = await CheckForUpdatesAsync(nodeId, cancellationToken);
        if (availability == null || !availability.HasUpdates)
        {
            _logger.LogInformation("No updates available for node {NodeId}", nodeId);
            return null;
        }

        var settings = await GetNodeSettingsAsync(db, nodeId, cancellationToken);

        // Check if auto-approve is enabled
        var autoApprove = settings.AutoApproveUpdates;
        var initialStatus = autoApprove ? "Approved" : "Pending";

        // Create update history record
        var update = new SystemUpdateHistory
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            StartedAt = DateTime.UtcNow,
            Status = initialStatus,
            UpdateType = DetermineUpdateType(availability.Packages),
            PackagesJson = JsonSerializer.Serialize(availability.Packages),
            RebootRequired = false,
            ActorType = GetActorType(),
            ActorId = GetActorId()
        };

        db.SystemUpdateHistories.Add(update);
        await db.SaveChangesAsync(cancellationToken);

        // Store pending update ID if not auto-approved
        if (!autoApprove)
        {
            await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.PendingUpdateId, update.Id.ToString(), cancellationToken);

            // Send SignalR event for pending update
            await _hubContext.Clients.Group(AgentHub.DashboardGroupName)
                .SendAsync("PendingUpdateCreated", nodeId, "system", update.Id.ToString());
        }

        await AuditAsync(db, nodeId, "systemupdate.created",
            $"System update created with {availability.Packages.Count} package(s). Status: {initialStatus}");

        _logger.LogInformation("Created system update {UpdateId} for node {NodeId} with status {Status}",
            update.Id, nodeId, initialStatus);

        // If auto-approved, start execution
        if (autoApprove)
        {
            _ = Task.Run(() => ExecuteUpdateAsync(update.Id, cancellationToken), cancellationToken);
        }

        return update.Id;
    }

    /// <summary>
    /// Approves a pending system update and starts execution.
    /// </summary>
    public async Task<bool> ApproveUpdateAsync(
        Guid updateId,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var update = await db.SystemUpdateHistories
            .Include(h => h.Node)
            .FirstOrDefaultAsync(h => h.Id == updateId, cancellationToken);

        if (update == null)
        {
            return false;
        }

        if (update.Status != "Pending")
        {
            _logger.LogWarning("Update {UpdateId} is not in Pending state (current: {Status})", updateId, update.Status);
            return false;
        }

        update.Status = "Approved";
        await db.SaveChangesAsync(cancellationToken);

        // Clear pending update ID from settings
        await UpdateNodeSettingAsync(db, update.NodeId, SettingKeys.SystemUpdate.PendingUpdateId, "", cancellationToken);

        await AuditAsync(db, update.NodeId, "systemupdate.approved", $"System update {updateId} approved");

        // Send SignalR event for approval
        await _hubContext.Clients.Group(AgentHub.DashboardGroupName)
            .SendAsync("PendingUpdateApproved", update.NodeId, "system", updateId.ToString());

        // Start execution in background
        _ = Task.Run(() => ExecuteUpdateAsync(updateId, cancellationToken), cancellationToken);

        return true;
    }

    /// <summary>
    /// Rejects and cancels a pending system update.
    /// </summary>
    public async Task<bool> RejectUpdateAsync(
        Guid updateId,
        string? reason = null,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var update = await db.SystemUpdateHistories
            .Include(h => h.Node)
            .FirstOrDefaultAsync(h => h.Id == updateId, cancellationToken);

        if (update == null)
        {
            return false;
        }

        if (update.Status != "Pending")
        {
            return false;
        }

        update.Status = "Cancelled";
        update.CompletedAt = DateTime.UtcNow;
        update.ErrorMessage = reason ?? "Rejected by user";

        await db.SaveChangesAsync(cancellationToken);

        // Clear pending update ID
        await UpdateNodeSettingAsync(db, update.NodeId, SettingKeys.SystemUpdate.PendingUpdateId, "", cancellationToken);

        await AuditAsync(db, update.NodeId, "systemupdate.rejected",
            $"System update {updateId} rejected: {reason}");

        // Send SignalR event for rejection
        await _hubContext.Clients.Group(AgentHub.DashboardGroupName)
            .SendAsync("PendingUpdateRejected", update.NodeId, "system", updateId.ToString());

        _logger.LogInformation("Rejected system update {UpdateId} for node {NodeId}: {Reason}",
            updateId, update.NodeId, reason);

        return true;
    }

    /// <summary>
    /// Executes an approved system update.
    /// </summary>
    public async Task<bool> ExecuteUpdateAsync(
        Guid updateId,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var update = await db.SystemUpdateHistories
            .Include(h => h.Node)
            .FirstOrDefaultAsync(h => h.Id == updateId, cancellationToken);

        if (update == null)
        {
            _logger.LogError("Update {UpdateId} not found", updateId);
            return false;
        }

        if (update.Status != "Approved")
        {
            _logger.LogWarning("Update {UpdateId} is not in Approved state (current: {Status})", updateId, update.Status);
            return false;
        }

        // Get SSH credentials
        var machine = await db.OnboardingMachines
            .FirstOrDefaultAsync(m => m.LinkedNodeId == update.NodeId, cancellationToken);

        if (machine == null)
        {
            await FailUpdateAsync(db, update, "No SSH credentials available");
            return false;
        }

        update.Status = "InProgress";
        await db.SaveChangesAsync(cancellationToken);

        try
        {
            var options = await CreateSshConnectionOptionsAsync(machine, cancellationToken);
            var settings = await GetNodeSettingsAsync(db, update.NodeId, cancellationToken);
            var osType = DetermineOsType(update.Node!);
            var packageManager = settings.PackageManager ?? DeterminePackageManager(osType);

            var updateOptions = new SystemUpdateOptions
            {
                IncludeSecurityUpdates = settings.IncludeSecurityUpdates,
                IncludeFeatureUpdates = settings.IncludeFeatureUpdates,
                IncludeDriverUpdates = settings.IncludeDriverUpdates
            };

            // Build and execute update command
            var updateCommand = PlatformCommandBuilder.BuildUpdateCommand(osType, updateOptions, packageManager);

            await LogAsync(db, updateId, "Info", "Starting system update", cancellationToken: cancellationToken);

            var output = await _sshProvisioningService.ExecuteCommandAsync(options, updateCommand, cancellationToken);
            update.OutputLog = output;

            await LogAsync(db, updateId, "Info", "System update completed", cancellationToken: cancellationToken);

            // Check if reboot is required
            var rebootCheckCommand = PlatformCommandBuilder.BuildRebootCheckCommand(osType, packageManager);
            var rebootOutput = await _sshProvisioningService.ExecuteCommandAsync(options, rebootCheckCommand, cancellationToken);
            update.RebootRequired = rebootOutput.Contains("REBOOT_REQUIRED", StringComparison.OrdinalIgnoreCase);

            // Update status
            update.Status = "Completed";
            update.CompletedAt = DateTime.UtcNow;

            // Update last success time
            await UpdateNodeSettingAsync(db, update.NodeId, SettingKeys.SystemUpdate.LastUpdateAt, DateTime.UtcNow.ToString("o"), cancellationToken);
            await UpdateNodeSettingAsync(db, update.NodeId, SettingKeys.SystemUpdate.FailureCount, "0", cancellationToken);

            await db.SaveChangesAsync(cancellationToken);

            await AuditAsync(db, update.NodeId, "systemupdate.completed", $"System update {updateId} completed successfully");

            _logger.LogInformation("System update {UpdateId} completed successfully for node {NodeId}",
                updateId, update.NodeId);

            return true;
        }
        catch (Exception ex)
        {
            await FailUpdateAsync(db, update, $"Update failed: {ex.Message}", cancellationToken);
            return false;
        }
    }

    /// <summary>
    /// Approves and executes a reboot for an update that requires it.
    /// </summary>
    public async Task<bool> ApproveRebootAsync(
        Guid updateId,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var update = await db.SystemUpdateHistories
            .Include(h => h.Node)
            .FirstOrDefaultAsync(h => h.Id == updateId, cancellationToken);

        if (update == null)
        {
            return false;
        }

        if (!update.RebootRequired)
        {
            _logger.LogWarning("Update {UpdateId} does not require a reboot", updateId);
            return false;
        }

        // Get SSH credentials
        var machine = await db.OnboardingMachines
            .FirstOrDefaultAsync(m => m.LinkedNodeId == update.NodeId, cancellationToken);

        if (machine == null)
        {
            return false;
        }

        try
        {
            var options = await CreateSshConnectionOptionsAsync(machine, cancellationToken);
            var rebootCommand = DetermineRebootCommand(update.Node!);
            await _sshProvisioningService.ExecuteCommandAsync(options, rebootCommand, cancellationToken);

            update.RebootApproved = true;
            update.RebootedAt = DateTime.UtcNow;

            await db.SaveChangesAsync(cancellationToken);

            await AuditAsync(db, update.NodeId, "systemupdate.rebooted", $"Reboot approved and executed for update {updateId}");

            _logger.LogInformation("Reboot executed for node {NodeId} as part of update {UpdateId}",
                update.NodeId, updateId);

            return true;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to reboot node {NodeId} for update {UpdateId}",
                update.NodeId, updateId);
            return false;
        }
    }

    /// <summary>
    /// Cleans up any updates that were left InProgress during a server shutdown.
    /// </summary>
    public async Task CleanupStuckUpdatesAsync(CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var stuckUpdates = await db.SystemUpdateHistories
            .Where(h => h.Status == "InProgress")
            .ToListAsync(cancellationToken);

        if (stuckUpdates.Count == 0)
        {
            return;
        }

        _logger.LogInformation("Found {Count} stuck system updates. Marking as failed.", stuckUpdates.Count);

        foreach (var update in stuckUpdates)
        {
            update.Status = "Failed";
            update.CompletedAt = DateTime.UtcNow;
            update.ErrorMessage = "System update interrupted by server shutdown";

            // Also reset the node failure count so it doesn't immediately disable updates if this was a fluke
            // (Optional, but maybe safer to leave failure count logic to the main flow. 
            // However, failUpdateAsync increments it. Here we are just marking as failed.)
            
            // We should probably log this failure to the node's history/audit
            await AuditAsync(db, update.NodeId, "systemupdate.failed", 
                $"System update {update.Id} marked as failed due to server shutdown");
        }

        await db.SaveChangesAsync(cancellationToken);
    }

    #endregion

    #region History and Logs

    /// <summary>
    /// Gets the update history for a node.
    /// </summary>
    public async Task<List<SystemUpdateHistory>> GetUpdateHistoryAsync(
        Guid nodeId,
        int limit = 50,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        return await db.SystemUpdateHistories
            .Where(h => h.NodeId == nodeId)
            .OrderByDescending(h => h.StartedAt)
            .Take(limit)
            .ToListAsync(cancellationToken);
    }

    /// <summary>
    /// Gets detailed logs for an update.
    /// </summary>
    public async Task<List<SystemUpdateLog>> GetUpdateLogsAsync(
        Guid updateId,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        return await db.SystemUpdateLogs
            .Where(l => l.UpdateHistoryId == updateId)
            .OrderBy(l => l.TimestampUtc)
            .ToListAsync(cancellationToken);
    }

    #endregion

    #region Settings

    /// <summary>
    /// Gets system update settings for a node.
    /// </summary>
    public async Task<SystemUpdateNodeSettings> GetNodeSettingsAsync(
        Guid nodeId,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        return await GetNodeSettingsAsync(db, nodeId, cancellationToken);
    }

    /// <summary>
    /// Updates system update settings for a node.
    /// </summary>
    public async Task UpdateNodeSettingsAsync(
        Guid nodeId,
        SystemUpdateNodeSettings settings,
        CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.Enabled, settings.Enabled.ToString().ToLowerInvariant(), cancellationToken);
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.MaintenanceWindow, settings.MaintenanceWindow ?? "", cancellationToken);
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.ScheduledDayOfWeek, settings.ScheduledDayOfWeek?.ToString() ?? "", cancellationToken);
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.CheckIntervalMinutes, settings.CheckIntervalMinutes.ToString(), cancellationToken);
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.IncludeSecurityUpdates, settings.IncludeSecurityUpdates.ToString().ToLowerInvariant(), cancellationToken);
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.IncludeFeatureUpdates, settings.IncludeFeatureUpdates.ToString().ToLowerInvariant(), cancellationToken);
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.IncludeDriverUpdates, settings.IncludeDriverUpdates.ToString().ToLowerInvariant(), cancellationToken);
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.AutoApproveUpdates, settings.AutoApproveUpdates.ToString().ToLowerInvariant(), cancellationToken);
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.AutoRebootIfNeeded, settings.AutoRebootIfNeeded.ToString().ToLowerInvariant(), cancellationToken);
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.PackageManager, settings.PackageManager ?? "", cancellationToken);

        await AuditAsync(db, nodeId, "systemupdate.settings_updated", "System update settings updated");
    }

    #endregion

    #region Private Helpers

    private async Task<SystemUpdateNodeSettings> GetNodeSettingsAsync(
        DataContext db,
        Guid nodeId,
        CancellationToken cancellationToken)
    {
        var settingsDict = await db.NodeSettings
            .Where(s => s.NodeId == nodeId && s.Key.StartsWith("SystemUpdate."))
            .ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);

        var parseBool = (string key, bool defaultValue) =>
        {
            var val = settingsDict.GetValueOrDefault(key);
            return bool.TryParse(val, out var result) ? result : defaultValue;
        };

        var parseInt = (string key, int defaultValue) =>
        {
            var val = settingsDict.GetValueOrDefault(key);
            return int.TryParse(val, out var result) ? result : defaultValue;
        };

        return new SystemUpdateNodeSettings
        {
            Enabled = parseBool(SettingKeys.SystemUpdate.Enabled, false),
            MaintenanceWindow = settingsDict.GetValueOrDefault(SettingKeys.SystemUpdate.MaintenanceWindow),
            ScheduledDayOfWeek = parseInt(SettingKeys.SystemUpdate.ScheduledDayOfWeek, -1) switch { -1 => null, var v => v },
            CheckIntervalMinutes = parseInt(SettingKeys.SystemUpdate.CheckIntervalMinutes, 360),
            IncludeSecurityUpdates = parseBool(SettingKeys.SystemUpdate.IncludeSecurityUpdates, true),
            IncludeFeatureUpdates = parseBool(SettingKeys.SystemUpdate.IncludeFeatureUpdates, true),
            IncludeDriverUpdates = parseBool(SettingKeys.SystemUpdate.IncludeDriverUpdates, true),
            AutoApproveUpdates = parseBool(SettingKeys.SystemUpdate.AutoApproveUpdates, false),
            AutoRebootIfNeeded = parseBool(SettingKeys.SystemUpdate.AutoRebootIfNeeded, false),
            PackageManager = settingsDict.GetValueOrDefault(SettingKeys.SystemUpdate.PackageManager)
        };
    }

    private async Task<SshProvisioningService.ConnectionOptions> CreateSshConnectionOptionsAsync(
        OnboardingMachine machine,
        CancellationToken cancellationToken)
    {
        var credentialService = _scopeFactory.CreateScope().ServiceProvider.GetRequiredService<CredentialEncryptionService>();

        if (!string.IsNullOrWhiteSpace(machine.EncryptedSshPassword))
        {
            var password = await credentialService.DecryptAsync(machine.EncryptedSshPassword);
            return new SshProvisioningService.ConnectionOptions(
                Host: machine.Host,
                Port: machine.Port,
                Username: machine.Username,
                Auth: new SshProvisioningService.PasswordAuth(password ?? ""),
                ExpectedHostKeyFingerprint: machine.HostKeyFingerprint,
                TrustOnFirstUse: machine.TrustHostKey
            );
        }
        else if (!string.IsNullOrWhiteSpace(machine.EncryptedPrivateKeyPem))
        {
            var privateKey = await credentialService.DecryptAsync(machine.EncryptedPrivateKeyPem);
            var passphrase = !string.IsNullOrWhiteSpace(machine.EncryptedPrivateKeyPassphrase)
                ? await credentialService.DecryptAsync(machine.EncryptedPrivateKeyPassphrase)
                : null;

            return new SshProvisioningService.ConnectionOptions(
                Host: machine.Host,
                Port: machine.Port,
                Username: machine.Username,
                Auth: new SshProvisioningService.PrivateKeyAuth(privateKey ?? "", passphrase),
                ExpectedHostKeyFingerprint: machine.HostKeyFingerprint,
                TrustOnFirstUse: machine.TrustHostKey
            );
        }

        throw new InvalidOperationException("No valid SSH credentials available");
    }

    private static async Task LogAsync(
        DataContext db,
        Guid updateId,
        string level,
        string message,
        string? details = null,
        CancellationToken cancellationToken = default)
    {
        await db.SystemUpdateLogs.AddAsync(new SystemUpdateLog
        {
            Id = Guid.NewGuid(),
            UpdateHistoryId = updateId,
            Level = level,
            Message = message,
            Details = details
        }, cancellationToken);

        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task FailUpdateAsync(DataContext db, SystemUpdateHistory update, string error, CancellationToken cancellationToken = default)
    {
        update.Status = "Failed";
        update.CompletedAt = DateTime.UtcNow;
        update.ErrorMessage = error.Length > 2000 ? error[..2000] : error;

        await db.SaveChangesAsync(cancellationToken);

        await RecordFailureAsync(db, update.NodeId, error);

        await AuditAsync(db, update.NodeId, "systemupdate.failed",
            $"System update {update.Id} failed: {error}");

        _logger.LogError("System update {UpdateId} failed for node {NodeId}: {Error}",
            update.Id, update.NodeId, error);
    }

    private async Task RecordFailureAsync(DataContext db, Guid nodeId, string error, CancellationToken cancellationToken = default)
    {
        var failureCountStr = await GetNodeSettingValueAsync(db, nodeId, SettingKeys.SystemUpdate.FailureCount, cancellationToken);
        var failureCount = int.TryParse(failureCountStr, out var count) ? count + 1 : 1;

        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.FailureCount, failureCount.ToString(), cancellationToken);

        if (failureCount >= MaxFailureCount)
        {
            await UpdateNodeSettingAsync(db, nodeId, SettingKeys.SystemUpdate.Enabled, "false", cancellationToken);
            _logger.LogWarning("System update disabled for node {NodeId} after {Count} consecutive failures",
                nodeId, failureCount);
        }
    }

    private async Task UpdateNodeSettingAsync(DataContext db, Guid nodeId, string key, string value, CancellationToken cancellationToken = default)
    {
        var setting = await db.NodeSettings.FindAsync(new object[] { nodeId, key }, cancellationToken);
        if (setting == null)
        {
            db.NodeSettings.Add(new NodeSetting
            {
                NodeId = nodeId,
                Key = key,
                Value = string.IsNullOrEmpty(value) ? null : value,
                Category = "SystemUpdate",
                UpdatedAt = DateTime.UtcNow
            });
        }
        else
        {
            setting.Value = string.IsNullOrEmpty(value) ? null : value;
            setting.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync(cancellationToken);
    }

    private async Task<string?> GetNodeSettingValueAsync(DataContext db, Guid nodeId, string key, CancellationToken cancellationToken = default)
    {
        var setting = await db.NodeSettings.FindAsync(new object[] { nodeId, key }, cancellationToken);
        return setting?.Value;
    }

    private async Task AuditAsync(DataContext db, Guid nodeId, string eventName, string message)
    {
        _audit.TryEnqueue(new AuditEvent
        {
            Kind = "activity",
            EventName = eventName,
            Category = "system-update",
            Source = GetActorType(),
            ActorType = GetActorType(),
            ActorId = GetActorId(),
            NodeId = nodeId,
            Success = true,
            Message = message
        });
    }

    private static string DetermineOsType(Node node)
    {
        var os = node.OS?.ToLowerInvariant() ?? "";
        if (os.Contains("linux")) return "linux";
        if (os.Contains("windows") || os.Contains("win")) return "windows";
        if (os.Contains("macos") || os.Contains("darwin") || os.Contains("mac")) return "macos";
        return "linux"; // Default to Linux
    }

    private static string? DeterminePackageManager(string osType)
    {
        // Will be auto-detected on the actual system
        return null;
    }

    private static string DetermineUpdateType(List<SystemPackage> packages)
    {
        if (packages.Any(p => p.Type == "security")) return "Security";
        if (packages.Any(p => p.Type == "driver")) return "Driver";
        return "Feature";
    }

    private static string DetermineRebootCommand(Node node)
    {
        var os = node.OS?.ToLowerInvariant() ?? "";
        if (os.Contains("linux") || os.Contains("mac"))
        {
            return "sudo reboot";
        }
        else if (os.Contains("windows"))
        {
            return "shutdown /r /t 10";
        }
        return "sudo reboot";
    }

    private string GetActorType()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        if (user?.Identity?.IsAuthenticated == true)
        {
            return "user";
        }
        return "system";
    }

    private string? GetActorId()
    {
        var user = _httpContextAccessor.HttpContext?.User;
        if (user?.Identity?.IsAuthenticated == true)
        {
            return user.Identity.Name;
        }
        return null;
    }

    #endregion
}

#region Public Data Types

/// <summary>
/// System update availability information.
/// </summary>
public sealed class SystemUpdateAvailability
{
    public bool HasUpdates { get; set; }
    public List<SystemPackage> Packages { get; set; } = new();
    public int SecurityUpdates { get; set; }
    public bool RebootRequired { get; set; }
    public DateTime CheckedAt { get; set; }
}

/// <summary>
/// System update node settings.
/// </summary>
public sealed class SystemUpdateNodeSettings
{
    public bool Enabled { get; set; }
    public string? MaintenanceWindow { get; set; }
    public int? ScheduledDayOfWeek { get; set; }
    public int CheckIntervalMinutes { get; set; } = 360;
    public bool IncludeSecurityUpdates { get; set; } = true;
    public bool IncludeFeatureUpdates { get; set; } = true;
    public bool IncludeDriverUpdates { get; set; } = true;
    public bool AutoApproveUpdates { get; set; }
    public bool AutoRebootIfNeeded { get; set; }
    public string? PackageManager { get; set; }
}

#endregion
