using ManLab.Server.Constants;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Ssh;
using ManLab.Server.Services.Security;
using ManLab.Server.Hubs;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace ManLab.Server.Services;

/// <summary>
/// Service for managing automatic agent updates.
/// </summary>
public sealed class AutoUpdateService
{
    private const int MaxFailureCount = 5;
    private const int MinCheckIntervalMinutes = 15;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<AutoUpdateService> _logger;
    private readonly IAuditLog _audit;
    private readonly IOptions<BinaryDistributionOptions> _binaryOptions;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IHttpContextAccessor _httpContextAccessor;
    private readonly ISettingsService _settingsService;
    private readonly IHubContext<AgentHub> _hubContext;

    public AutoUpdateService(
        IServiceScopeFactory scopeFactory,
        ILogger<AutoUpdateService> logger,
        IAuditLog audit,
        IOptions<BinaryDistributionOptions> binaryOptions,
        IHttpClientFactory httpClientFactory,
        IHttpContextAccessor httpContextAccessor,
        ISettingsService settingsService,
        IHubContext<AgentHub> hubContext)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _audit = audit;
        _binaryOptions = binaryOptions;
        _httpClientFactory = httpClientFactory;
        _httpContextAccessor = httpContextAccessor;
        _settingsService = settingsService;
        _hubContext = hubContext;
    }

    /// <summary>
    /// Checks all nodes with auto-update enabled and applies updates if eligible.
    /// This method is called by the scheduled Quartz job.
    /// </summary>
    /// <param name="force">Whether to force checking all nodes regardless of schedule.</param>
    /// <param name="jobApprovalMode">Job-level approval mode ("automatic" or "manual"). If provided, overrides node-level settings.</param>
    public async Task CheckAndApplyUpdatesAsync(bool force = false, string? jobApprovalMode = null, CancellationToken cancellationToken = default)
    {
        _logger.LogInformation("Auto-update job starting (Force: {Force}, JobApprovalMode: {JobApprovalMode})", force, jobApprovalMode);

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Get all nodes with auto-update enabled
        var nodesWithAutoUpdate = await db.Nodes
            .AsNoTracking()
            .Join(
                db.NodeSettings.Where(s => s.Key == SettingKeys.AutoUpdate.Enabled && s.Value == "true"),
                node => node.Id,
                setting => setting.NodeId,
                (node, _) => node)
            .Where(n => n.Status == NodeStatus.Online)
            .ToListAsync(cancellationToken);

        _logger.LogInformation("Auto-update check: {Count} online nodes with auto-update enabled (Force: {Force})", nodesWithAutoUpdate.Count, force);

        // Always create an audit entry to show job ran (for visibility in history)
        // Write directly to DB (bypass queue) for immediate visibility
        var triggerType = force ? "Manual" : "Scheduled";
        _logger.LogInformation("Creating audit entry for {TriggerType} job execution", triggerType);
        await CreateAuditEntryDirectlyAsync(db, "auto-update.check",
            $"{triggerType} check completed. Found {nodesWithAutoUpdate.Count} online node(s) with auto-update enabled.",
            cancellationToken);
        _logger.LogInformation("Audit entry created successfully");

        if (nodesWithAutoUpdate.Count == 0)
        {
            _logger.LogInformation("No nodes with auto-update enabled found");
            return;
        }

        foreach (var node in nodesWithAutoUpdate)
        {
            try
            {
                await ProcessNodeAutoUpdateAsync(db, node, force, jobApprovalMode, cancellationToken);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to process auto-update for node {NodeId}", node.Id);
            }
        }
    }

    /// <summary>
    /// Processes auto-update for a single node.
    /// </summary>
    private async Task ProcessNodeAutoUpdateAsync(DataContext db, Node node, bool force, string? jobApprovalMode, CancellationToken cancellationToken)
    {
        _logger.LogInformation("Processing auto-update check for node {NodeId} ({NodeName})", node.Id, node.Hostname);
        
        var settings = await GetNodeAutoUpdateSettingsAsync(db, node.Id, cancellationToken);
        if (!settings.IsEnabled && !force)
        {
            _logger.LogInformation("Node {NodeId}: Auto-update not enabled, skipping", node.Id);
            return;
        }

        // Use job-level approval mode if provided, otherwise use node-level setting
        var effectiveApprovalMode = jobApprovalMode ?? settings.ApprovalMode;

        // Check if within maintenance window (skip if forced)
        if (!force && !IsWithinMaintenanceWindow(settings.MaintenanceWindow))
        {
            _logger.LogInformation("Node {NodeId}: Outside maintenance window, skipping auto-update", node.Id);
            return;
        }

        // Check if we've recently checked (min interval protection) (skip if forced)
        if (!force && settings.LastCheckAt.HasValue)
        {
            var timeSinceLastCheck = DateTime.UtcNow.Subtract(settings.LastCheckAt.Value);
            
            // If check was in the future (negative duration), treat as invalid and allow check to self-heal
            if (timeSinceLastCheck.TotalMinutes < 0)
            {
                 _logger.LogWarning("Node {NodeId}: Last check time was in the future ({Time}), proceeding with check to correct.", node.Id, settings.LastCheckAt.Value);
            }
            // If check was recent (positive and less than interval), skip
            else if (timeSinceLastCheck.TotalMinutes < MinCheckIntervalMinutes)
            {
                _logger.LogInformation("Node {NodeId}: Checked {Minutes} minutes ago (min interval: {MinInterval}), skipping", 
                    node.Id, (int)timeSinceLastCheck.TotalMinutes, MinCheckIntervalMinutes);
                return;
            }
        }

        // Update last check time
        await UpdateNodeSettingAsync(db, node.Id, SettingKeys.AutoUpdate.LastCheckAt, DateTime.UtcNow.ToString("o"));

        // Check for available update
        var (hasUpdate, latestVersion, source) = await CheckForUpdateAsync(node.Id, settings.Channel, cancellationToken);

        if (force)
        {
            await AuditAsync(db, node.Id, "auto-update.check", $"Forced check completed. Update available: {hasUpdate} (Latest: {latestVersion ?? "none"})");
        }

        if (!hasUpdate || latestVersion == null)
        {
            _logger.LogInformation("Node {NodeId}: Already up to date (current: {Version})", node.Id, node.AgentVersion ?? "unknown");
            return;
        }

        _logger.LogInformation("Update available for node {NodeId}: current={Current}, latest={Latest}, source={Source}",
            node.Id, node.AgentVersion ?? "unknown", latestVersion, source);

        // Check if update is already pending approval
        if (effectiveApprovalMode == "manual" && settings.PendingVersion == latestVersion)
        {
            _logger.LogInformation("Node {NodeId}: Update to {Version} already pending approval", node.Id, latestVersion);
            return;
        }

        // Handle approval mode
        if (effectiveApprovalMode == "manual")
        {
            await SetPendingUpdateAsync(db, node.Id, latestVersion);
            _logger.LogInformation("Node {NodeId} update to {Version} requires manual approval", node.Id, latestVersion);
            await AuditAsync(db, node.Id, "auto-update.pending", $"Update to version {latestVersion} pending approval");

            // Send SignalR event
            await _hubContext.Clients.Group(AgentHub.DashboardGroupName)
                .SendAsync("PendingUpdateCreated", node.Id, "agent", (object?)null);

            return;
        }

        // Automatic mode - trigger update
        await TriggerAutoUpdateAsync(db, node, settings, latestVersion, cancellationToken);
    }

    /// <summary>
    /// Checks if a node has an available update.
    /// </summary>
    private async Task<(bool HasUpdate, string? LatestVersion, string Source)> CheckForUpdateAsync(
        Guid nodeId,
        string channel,
        CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var node = await db.Nodes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == nodeId, cancellationToken);
        if (node?.AgentVersion == null)
        {
            return (false, null, "none");
        }

        // Get release catalog
        var catalog = await GetReleaseCatalogAsync(channel, cancellationToken);
        if (catalog == null)
        {
            return (false, null, "none");
        }

        // Find latest version using the new strategy
        var (latestVersion, source) = await GetLatestAvailableVersionAsync(catalog, node.AgentVersion, cancellationToken);
        if (latestVersion == null)
        {
            return (false, null, source);
        }

        // Compare versions
        var current = ParseVersion(node.AgentVersion);
        var latest = ParseVersion(latestVersion);

        return (latest > current, latestVersion, source);
    }

    /// <summary>
    /// Gets the release catalog from the binaries API.
    /// </summary>
    private async Task<JsonObject?> GetReleaseCatalogAsync(
        string channel,
        CancellationToken cancellationToken)
    {
        try
        {
            var client = _httpClientFactory.CreateClient();
            var baseUrl = GetServerBaseUrl();
            var url = $"{baseUrl}/api/binaries/agent/release-catalog?channel={channel}";

            var response = await client.GetAsync(url, cancellationToken);
            if (!response.IsSuccessStatusCode)
            {
                return null;
            }

            await using var stream = await response.Content.ReadAsStreamAsync(cancellationToken);
            var doc = await JsonNode.ParseAsync(stream, cancellationToken: cancellationToken);

            return doc as JsonObject;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to get release catalog for channel {Channel}", channel);
            return null;
        }
    }

    /// <summary>
    /// Gets the latest available version from the catalog.
    /// </summary>
    private async Task<(string? Version, string Source)> GetLatestAvailableVersionAsync(
        JsonObject catalog, 
        string currentVersion,
        CancellationToken cancellationToken)
    {
        var local = catalog["local"] as JsonArray;
        var github = catalog["gitHub"] as JsonObject;

        // Determine source preference
        var preferGitHub = await _settingsService.GetValueAsync(
            Constants.SettingKeys.GitHub.PreferGitHubForUpdates, 
            false);

        string? latestLocal = null;
        string? latestGitHub = null;

        // Check local releases
        if (local != null && local.Count > 0)
        {
            foreach (var item in local)
            {
                if (item is JsonObject obj &&
                    obj.TryGetPropertyValue("version", out var versionNode) &&
                    versionNode is JsonValue versionValue)
                {
                    var version = versionValue.ToString();
                    if (!string.Equals(version, "staged", StringComparison.OrdinalIgnoreCase))
                    {
                        if (latestLocal == null || CompareVersions(version, latestLocal) > 0)
                        {
                            latestLocal = version;
                        }
                    }
                }
            }
        }

        // Check GitHub releases
        if (github != null &&
            github.TryGetPropertyValue("enabled", out var enabledNode) &&
            enabledNode is JsonValue enabledValue &&
            enabledValue.GetValue<bool>() &&
            github.TryGetPropertyValue("releases", out var releasesNode) &&
            releasesNode is JsonArray releases)
        {
            var versionStrategy = await _settingsService.GetValueAsync(
                Constants.SettingKeys.GitHub.VersionStrategy, 
                "latest-stable");

            var includePrerelease = string.Equals(versionStrategy, "latest-prerelease", StringComparison.OrdinalIgnoreCase);

            foreach (var item in releases)
            {
                if (item is JsonObject obj &&
                    obj.TryGetPropertyValue("tag", out var tagNode) &&
                    tagNode is JsonValue tagValue &&
                    obj.TryGetPropertyValue("prerelease", out var preNode) &&
                    preNode is JsonValue preValue &&
                    obj.TryGetPropertyValue("draft", out var draftNode) &&
                    draftNode is JsonValue draftValue)
                {
                    var isPrerelease = preValue.GetValue<bool>();
                    var isDraft = draftValue.GetValue<bool>();

                    // Skip drafts always
                    if (isDraft) continue;

                    // Skip prereleases unless strategy allows them
                    if (isPrerelease && !includePrerelease) continue;

                    var tag = tagValue.ToString().TrimStart('v');
                    if (latestGitHub == null || CompareVersions(tag, latestGitHub) > 0)
                    {
                        latestGitHub = tag;
                    }
                }
            }
        }

        // Select the best version based on preference and availability
        string? selectedVersion = null;
        string source = "none";

        if (preferGitHub)
        {
            // Prefer GitHub, fall back to local
            if (latestGitHub != null && CompareVersions(latestGitHub, currentVersion) > 0)
            {
                selectedVersion = latestGitHub;
                source = "github";
            }
            else if (latestLocal != null && CompareVersions(latestLocal, currentVersion) > 0)
            {
                selectedVersion = latestLocal;
                source = "local";
            }
        }
        else
        {
            // Prefer local, fall back to GitHub
            if (latestLocal != null && CompareVersions(latestLocal, currentVersion) > 0)
            {
                selectedVersion = latestLocal;
                source = "local";
            }
            else if (latestGitHub != null && CompareVersions(latestGitHub, currentVersion) > 0)
            {
                selectedVersion = latestGitHub;
                source = "github";
            }
        }

        return (selectedVersion, source);
    }

    /// <summary>
    /// Compares two version strings.
    /// </summary>
    private static int CompareVersions(string v1, string v2)
    {
        var version1 = ParseVersion(v1);
        var version2 = ParseVersion(v2);
        return version1.CompareTo(version2);
    }

    /// <summary>
    /// Triggers an automatic update for a node.
    /// </summary>
    private async Task TriggerAutoUpdateAsync(
        DataContext db,
        Node node,
        AutoUpdateSettings settings,
        string targetVersion,
        CancellationToken cancellationToken)
    {
        // Find linked onboarding machine
        var machine = await db.OnboardingMachines
            .FirstOrDefaultAsync(m => m.LinkedNodeId == node.Id, cancellationToken);

        if (machine == null)
        {
            _logger.LogWarning("Cannot auto-update node {NodeId}: no linked onboarding machine found", node.Id);
            await RecordFailureAsync(db, node.Id, "No SSH credentials available");
            return;
        }

        // Check if another job is already running
        var jobRunner = _scopeFactory.CreateScope().ServiceProvider.GetRequiredService<OnboardingJobRunner>();
        if (jobRunner.IsRunning(machine.Id))
        {
            _logger.LogDebug("Cannot auto-update node {NodeId}: another job is already running", node.Id);
            return;
        }

        _logger.LogInformation("Triggering auto-update for node {NodeId} to version {Version}", node.Id, targetVersion);

        // Get server base URL
        var serverBaseUrl = GetServerBaseUrl();

        // Determine install source based on preference
        var preferGitHub = await _scopeFactory.CreateScope().ServiceProvider
            .GetRequiredService<ISettingsService>()
            .GetValueAsync(Constants.SettingKeys.GitHub.PreferGitHubForUpdates, false);

        var githubEnabled = await _scopeFactory.CreateScope().ServiceProvider
            .GetRequiredService<ISettingsService>()
            .GetValueAsync(Constants.SettingKeys.GitHub.EnableGitHubDownload, false);

        var githubBaseUrl = await _scopeFactory.CreateScope().ServiceProvider
            .GetRequiredService<ISettingsService>()
            .GetValueAsync(Constants.SettingKeys.GitHub.ReleaseBaseUrl);

        string installSource = "local";
        string? githubUrl = null;

        if (preferGitHub && githubEnabled && !string.IsNullOrWhiteSpace(githubBaseUrl))
        {
            installSource = "github";
            githubUrl = githubBaseUrl;
        }

        // Determine auth method based on machine settings
        OnboardingJobRunner.InstallRequest request;
        var credentialService = _scopeFactory.CreateScope().ServiceProvider.GetRequiredService<CredentialEncryptionService>();

        // Decrypt sudo password if available
        string? sudoPassword = null;
        if (!string.IsNullOrWhiteSpace(machine.EncryptedSudoPassword))
        {
            sudoPassword = await credentialService.DecryptAsync(machine.EncryptedSudoPassword);
        }

        if (machine.AuthMode == SshAuthMode.Password && !string.IsNullOrWhiteSpace(machine.EncryptedSshPassword))
        {
            // Password authentication
            var password = await credentialService.DecryptAsync(machine.EncryptedSshPassword);
            if (password == null) return;

            request = new OnboardingJobRunner.InstallRequest(
                ServerBaseUrl: serverBaseUrl,
                Force: true,
                Auth: new SshProvisioningService.PasswordAuth(password),
                SudoPassword: sudoPassword,
                RunAsRoot: sudoPassword != null,
                AgentInstall: new SshProvisioningService.AgentInstallOptions(
                    Source: installSource,
                    Channel: settings.Channel,
                    Version: targetVersion,
                    GitHubReleaseBaseUrl: githubUrl),
                TargetNodeId: node.Id,
                TrustOnFirstUse: machine.TrustHostKey,
                ExpectedHostKeyFingerprint: machine.HostKeyFingerprint,
                Actor: "auto-update",
                ActorIp: null,
                RateLimitKey: $"autoupdate-{node.Id}"
            );
        }
        else if (machine.AuthMode == SshAuthMode.PrivateKey && !string.IsNullOrWhiteSpace(machine.EncryptedPrivateKeyPem))
        {
            // Private key authentication
            var privateKey = await credentialService.DecryptAsync(machine.EncryptedPrivateKeyPem);
            if (privateKey == null) return;

            var passphrase = !string.IsNullOrWhiteSpace(machine.EncryptedPrivateKeyPassphrase)
                ? await credentialService.DecryptAsync(machine.EncryptedPrivateKeyPassphrase)
                : null;

            request = new OnboardingJobRunner.InstallRequest(
                ServerBaseUrl: serverBaseUrl,
                Force: true,
                Auth: new SshProvisioningService.PrivateKeyAuth(privateKey, passphrase),
                SudoPassword: null,
                RunAsRoot: false,
                AgentInstall: new SshProvisioningService.AgentInstallOptions(
                    Source: installSource,
                    Channel: settings.Channel,
                    Version: targetVersion,
                    GitHubReleaseBaseUrl: githubUrl),
                TargetNodeId: node.Id,
                TrustOnFirstUse: machine.TrustHostKey,
                ExpectedHostKeyFingerprint: machine.HostKeyFingerprint,
                Actor: "auto-update",
                ActorIp: null,
                RateLimitKey: $"autoupdate-{node.Id}"
            );
        }
        else
        {
            _logger.LogWarning("Cannot auto-update node {NodeId}: no valid authentication credentials available", node.Id);
            await RecordFailureAsync(db, node.Id, "No authentication credentials available");
            return;
        }

        if (!jobRunner.TryStartInstall(machine.Id, request))
        {
            _logger.LogWarning("Failed to start auto-update job for node {NodeId}", node.Id);
            await RecordFailureAsync(db, node.Id, "Failed to start update job");
            return;
        }

        // Clear pending version and reset failure count
        await ClearPendingUpdateAsync(db, node.Id);
        await UpdateNodeSettingAsync(db, node.Id, SettingKeys.AutoUpdate.FailureCount, "0");

        await AuditAsync(db, node.Id, "auto-update.started", $"Automatic update to version {targetVersion} initiated");

        // Send SignalR event for approval
        await _hubContext.Clients.Group(AgentHub.DashboardGroupName)
            .SendAsync("PendingUpdateApproved", node.Id, "agent", (object?)null);
    }

    /// <summary>
    /// Gets the server base URL from configuration or defaults to a sensible value.
    /// </summary>
    private string GetServerBaseUrl()
    {
        var request = _httpContextAccessor.HttpContext?.Request;
        if (request != null)
        {
            return $"{request.Scheme}://{request.Host.Value}";
        }

        // Fallback to localhost (should be configured properly in production)
        return "http://localhost:5247";
    }

    /// <summary>
    /// Records an auto-update failure.
    /// </summary>
    private async Task RecordFailureAsync(DataContext db, Guid nodeId, string error)
    {
        var failureCountStr = await GetNodeSettingValueAsync(db, nodeId, SettingKeys.AutoUpdate.FailureCount);
        var failureCount = int.TryParse(failureCountStr, out var count) ? count + 1 : 1;

        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.AutoUpdate.FailureCount, failureCount.ToString());
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.AutoUpdate.LastError, error);

        // Disable auto-update after max consecutive failures
        if (failureCount >= MaxFailureCount)
        {
            await UpdateNodeSettingAsync(db, nodeId, SettingKeys.AutoUpdate.Enabled, "false");
            _logger.LogWarning("Auto-update disabled for node {NodeId} after {Count} consecutive failures", nodeId, failureCount);
            await AuditAsync(db, nodeId, "auto-update.disabled", $"Auto-update disabled after {failureCount} consecutive failures: {error}");
        }
    }

    /// <summary>
    /// Sets a pending update awaiting manual approval.
    /// </summary>
    private async Task SetPendingUpdateAsync(DataContext db, Guid nodeId, string version)
    {
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.AutoUpdate.PendingVersion, version);
    }

    /// <summary>
    /// Clears a pending update.
    /// </summary>
    private async Task ClearPendingUpdateAsync(DataContext db, Guid nodeId)
    {
        var setting = await db.NodeSettings.FindAsync(new object[] { nodeId, SettingKeys.AutoUpdate.PendingVersion });
        if (setting != null)
        {
            db.NodeSettings.Remove(setting);
            await db.SaveChangesAsync();
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
    /// Gets auto-update settings for a node.
    /// </summary>
    public async Task<AutoUpdateSettings> GetNodeAutoUpdateSettingsAsync(DataContext db, Guid nodeId, CancellationToken cancellationToken = default)
    {
        var settingsDict = await db.NodeSettings
            .Where(s => s.NodeId == nodeId && s.Key.StartsWith("AutoUpdate."))
            .ToDictionaryAsync(s => s.Key, s => s.Value, cancellationToken);

        return new AutoUpdateSettings
        {
            IsEnabled = settingsDict.GetValueOrDefault(SettingKeys.AutoUpdate.Enabled) == "true",
            Channel = settingsDict.GetValueOrDefault(SettingKeys.AutoUpdate.Channel) ?? "stable",
            MaintenanceWindow = settingsDict.GetValueOrDefault(SettingKeys.AutoUpdate.MaintenanceWindow),
            ApprovalMode = settingsDict.GetValueOrDefault(SettingKeys.AutoUpdate.ApprovalMode) ?? "manual",
            LastCheckAt = ParseDateTime(settingsDict.GetValueOrDefault(SettingKeys.AutoUpdate.LastCheckAt)),
            LastUpdateAt = ParseDateTime(settingsDict.GetValueOrDefault(SettingKeys.AutoUpdate.LastUpdateAt)),
            FailureCount = int.TryParse(settingsDict.GetValueOrDefault(SettingKeys.AutoUpdate.FailureCount), out var fc) ? fc : 0,
            PendingVersion = settingsDict.GetValueOrDefault(SettingKeys.AutoUpdate.PendingVersion),
            LastError = settingsDict.GetValueOrDefault(SettingKeys.AutoUpdate.LastError)
        };
    }

    /// <summary>
    /// Updates a node setting.
    /// </summary>
    private async Task UpdateNodeSettingAsync(DataContext db, Guid nodeId, string key, string value)
    {
        var setting = await db.NodeSettings.FindAsync(new object[] { nodeId, key });
        if (setting == null)
        {
            db.NodeSettings.Add(new NodeSetting
            {
                NodeId = nodeId,
                Key = key,
                Value = value,
                Category = "AutoUpdate",
                UpdatedAt = DateTime.UtcNow
            });
        }
        else
        {
            setting.Value = value;
            setting.UpdatedAt = DateTime.UtcNow;
        }
        await db.SaveChangesAsync();
    }

    /// <summary>
    /// Gets a node setting value.
    /// </summary>
    private async Task<string?> GetNodeSettingValueAsync(DataContext db, Guid nodeId, string key)
    {
        var setting = await db.NodeSettings.FindAsync(new object[] { nodeId, key });
        return setting?.Value;
    }

    /// <summary>
    /// Records an audit event (enqueued, written asynchronously).
    /// </summary>
    private async Task AuditAsync(DataContext db, Guid nodeId, string eventName, string message)
    {
        _audit.TryEnqueue(new AuditEvent
        {
            Kind = "activity",
            EventName = eventName,
            Category = "auto-update",
            Source = "system",
            ActorType = "system",
            NodeId = nodeId,
            Success = true,
            Message = message
        });
    }

    /// <summary>
    /// Records an audit event directly to the database (synchronous, bypasses queue).
    /// Used for manual triggers to ensure immediate visibility in history.
    /// </summary>
    private async Task CreateAuditEntryDirectlyAsync(DataContext db, string eventName, string message, CancellationToken cancellationToken = default)
    {
        try
        {
            // Note: Using execution strategy for retry support
            var strategy = db.Database.CreateExecutionStrategy();
            await strategy.ExecuteAsync(async (ct) =>
            {
                var auditEvent = new AuditEvent
                {
                    Id = Guid.NewGuid(),
                    Kind = "activity",
                    EventName = eventName,
                    Category = "auto-update",
                    Source = "system",
                    ActorType = "system",
                    NodeId = Guid.Empty,
                    Success = true,
                    Message = message,
                    TimestampUtc = DateTime.UtcNow
                };

                db.AuditEvents.Add(auditEvent);
                var rowsSaved = await db.SaveChangesAsync(ct);

                _logger.LogInformation("Created audit entry {AuditId}: {EventName} - {Message} (saved {Rows} row(s))",
                    auditEvent.Id, eventName, message, rowsSaved);

                return rowsSaved;
            }, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create audit entry: {EventName} - {Message}", eventName, message);
            throw;
        }
    }

    /// <summary>
    /// Parses a datetime string.
    /// </summary>
    private static DateTime? ParseDateTime(string? value)
    {
        return DateTime.TryParse(value, out var dt) ? dt : null;
    }

    /// <summary>
    /// Parses a version string for comparison.
    /// </summary>
    private static Version ParseVersion(string version)
    {
        // Strip 'v' prefix and any suffixes
        var clean = version.TrimStart('v').Split('-')[0].Split('+')[0];
        return Version.TryParse(clean, out var v) ? v : new Version(0, 0);
    }

    /// <summary>
    /// Record a successful auto-update.
    /// </summary>
    public async Task RecordSuccessAsync(Guid nodeId, string version)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.AutoUpdate.LastUpdateAt, DateTime.UtcNow.ToString("o"));
        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.AutoUpdate.FailureCount, "0");
        await ClearPendingUpdateAsync(db, nodeId);

        await AuditAsync(db, nodeId, "auto-update.completed", $"Successfully updated to version {version}");
    }

    /// <summary>
    /// Manually approves a pending update.
    /// </summary>
    public async Task<bool> ApprovePendingUpdateAsync(Guid nodeId, CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var settings = await GetNodeAutoUpdateSettingsAsync(db, nodeId, cancellationToken);
        if (string.IsNullOrEmpty(settings.PendingVersion))
        {
            return false;
        }

        var node = await db.Nodes.FirstOrDefaultAsync(n => n.Id == nodeId, cancellationToken);
        if (node == null)
        {
            return false;
        }

        await TriggerAutoUpdateAsync(db, node, settings, settings.PendingVersion, cancellationToken);
        return true;
    }

    /// <summary>
    /// Disables auto-update for a node.
    /// </summary>
    public async Task DisableAutoUpdateAsync(Guid nodeId, CancellationToken cancellationToken = default)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        await UpdateNodeSettingAsync(db, nodeId, SettingKeys.AutoUpdate.Enabled, "false");
        await AuditAsync(db, nodeId, "auto-update.disabled", "Auto-update manually disabled");
    }

    /// <summary>
    /// Auto-update settings for a node.
    /// </summary>
    public sealed class AutoUpdateSettings
    {
        public bool IsEnabled { get; init; }
        public string Channel { get; init; } = "stable";
        public string? MaintenanceWindow { get; init; }
        public string ApprovalMode { get; init; } = "manual";
        public DateTime? LastCheckAt { get; init; }
        public DateTime? LastUpdateAt { get; init; }
        public int FailureCount { get; init; }
        public string? PendingVersion { get; init; }
        public string? LastError { get; init; }
    }

    /// <summary>
    /// Version comparer for semantic version comparison.
    /// </summary>
    private sealed class VersionComparer : IComparer<string>
    {
        public static readonly VersionComparer Instance = new();

        public int Compare(string? x, string? y)
        {
            if (string.IsNullOrEmpty(x)) return string.IsNullOrEmpty(y) ? 0 : -1;
            if (string.IsNullOrEmpty(y)) return 1;

            var vx = ParseVersion(x.TrimStart('v'));
            var vy = ParseVersion(y.TrimStart('v'));

            return vx.CompareTo(vy);
        }
    }
}
