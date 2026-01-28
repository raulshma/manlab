using ManLab.Server.Constants;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Ssh;
using ManLab.Server.Services.SystemUpdate;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Http;
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

    public SystemUpdateService(
        IServiceScopeFactory scopeFactory,
        ILogger<SystemUpdateService> logger,
        IAuditLog audit,
        IHttpContextAccessor httpContextAccessor,
        SshProvisioningService sshProvisioningService)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _audit = audit;
        _httpContextAccessor = httpContextAccessor;
        _sshProvisioningService = sshProvisioningService;
    }

    #region Core Update Methods

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
