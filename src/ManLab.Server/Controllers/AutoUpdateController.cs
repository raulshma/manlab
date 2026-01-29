using ManLab.Server.Constants;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Services;
using ManLab.Server.Services.Audit;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers;

/// <summary>
/// REST API controller for managing automatic agent updates.
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.DevicesManage)]
public class AutoUpdateController : ControllerBase
{
    private readonly DataContext _dbContext;
    private readonly ILogger<AutoUpdateController> _logger;
    private readonly AutoUpdateService _autoUpdateService;
    private readonly AutoUpdateScheduler _scheduler;
    private readonly IAuditLog _audit;
    private readonly ISettingsService _settingsService;

    public AutoUpdateController(
        DataContext dbContext,
        ILogger<AutoUpdateController> logger,
        AutoUpdateService autoUpdateService,
        AutoUpdateScheduler scheduler,
        IAuditLog audit,
        ISettingsService settingsService)
    {
        _dbContext = dbContext;
        _logger = logger;
        _autoUpdateService = autoUpdateService;
        _scheduler = scheduler;
        _audit = audit;
        _settingsService = settingsService;
    }

    /// <summary>
    /// Gets the auto-update settings for a specific node.
    /// </summary>
    /// <param name="nodeId">The node ID.</param>
    /// <returns>The auto-update settings or 404 if node not found.</returns>
    [HttpGet("{nodeId:guid}")]
    public async Task<ActionResult<AutoUpdateSettingsDto>> GetNodeAutoUpdateSettings(Guid nodeId)
    {
        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound();
        }

        var settings = await _autoUpdateService.GetNodeAutoUpdateSettingsAsync(_dbContext, nodeId);

        var discordEnabled = await _settingsService.GetValueAsync(Constants.SettingKeys.Discord.Enabled, true);
        var discordWebhookUrl = await _settingsService.GetValueAsync(Constants.SettingKeys.Discord.WebhookUrl);
        var discordAvailable = discordEnabled && !string.IsNullOrWhiteSpace(discordWebhookUrl);

        return Ok(new AutoUpdateSettingsDto
        {
            NodeId = nodeId,
            Enabled = settings.IsEnabled,
            Channel = settings.Channel,
            MaintenanceWindow = settings.MaintenanceWindow,
            ApprovalMode = settings.ApprovalMode,
            LastCheckAt = settings.LastCheckAt,
            LastUpdateAt = settings.LastUpdateAt,
            FailureCount = settings.FailureCount,
            PendingVersion = settings.PendingVersion,
            LastError = settings.LastError,
            DisableDiscordNotification = settings.DisableDiscordNotification,
            DiscordNotificationsAvailable = discordAvailable
        });
    }

    /// <summary>
    /// Updates the auto-update settings for a specific node.
    /// </summary>
    /// <param name="nodeId">The node ID.</param>
    /// <param name="request">The auto-update settings.</param>
    /// <returns>No content on success, 404 if node not found.</returns>
    [HttpPut("{nodeId:guid}")]
    public async Task<IActionResult> UpdateNodeAutoUpdateSettings(
        Guid nodeId,
        [FromBody] UpdateAutoUpdateSettingsRequest request)
    {
        var node = await _dbContext.Nodes.FindAsync(nodeId);
        if (node == null)
        {
            return NotFound();
        }

        // Validate approval mode
        if (request.ApprovalMode != "automatic" && request.ApprovalMode != "manual")
        {
            return BadRequest("Approval mode must be 'automatic' or 'manual'");
        }

        // Validate maintenance window format if provided
        if (!string.IsNullOrWhiteSpace(request.MaintenanceWindow))
        {
            var parts = request.MaintenanceWindow.Split('-');
            if (parts.Length != 2 ||
                !TimeSpan.TryParse(parts[0], out var _) ||
                !TimeSpan.TryParse(parts[1], out var _))
            {
                return BadRequest("Maintenance window must be in format 'HH:MM-HH:MM' (UTC)");
            }
        }

        // Update settings
        await UpsertNodeSettingAsync(nodeId, SettingKeys.AutoUpdate.Enabled, request.Enabled.ToString().ToLowerInvariant());
        await UpsertNodeSettingAsync(nodeId, SettingKeys.AutoUpdate.Channel, request.Channel ?? "stable");
        await UpsertNodeSettingAsync(nodeId, SettingKeys.AutoUpdate.MaintenanceWindow, request.MaintenanceWindow);
        await UpsertNodeSettingAsync(nodeId, SettingKeys.AutoUpdate.ApprovalMode, request.ApprovalMode);

        // Update Discord notification opt-out if provided
        if (request.DisableDiscordNotification.HasValue)
        {
            await UpsertNodeSettingAsync(nodeId, SettingKeys.AutoUpdate.DisableDiscordNotification, request.DisableDiscordNotification.Value.ToString().ToLowerInvariant());
        }

        // If enabling, reset failure count
        if (request.Enabled)
        {
            await UpsertNodeSettingAsync(nodeId, SettingKeys.AutoUpdate.FailureCount, "0");
            await UpsertNodeSettingAsync(nodeId, SettingKeys.AutoUpdate.LastError, null);
        }

        _audit.TryEnqueue(AuditEventFactory.CreateHttp(
            kind: "audit",
            eventName: "autoupdate.settings.updated",
            httpContext: HttpContext,
            success: true,
            statusCode: 200,
            nodeId: nodeId,
            category: "auto-update",
            message: $"Auto-update settings updated (enabled={request.Enabled}, discordNotificationsDisabled={request.DisableDiscordNotification.GetValueOrDefault(false)})"));

        return NoContent();
    }

    /// <summary>
    /// Manually triggers an update check for a specific node.
    /// </summary>
    /// <param name="nodeId">The node ID.</param>
    /// <returns>202 Accepted on success, 404 if node not found.</returns>
    [HttpPost("{nodeId:guid}/check")]
    public async Task<IActionResult> TriggerUpdateCheck(Guid nodeId)
    {
        var node = await _dbContext.Nodes.FindAsync(nodeId);
        if (node == null)
        {
            return NotFound();
        }

        var settings = await _autoUpdateService.GetNodeAutoUpdateSettingsAsync(_dbContext, nodeId);
        if (!settings.IsEnabled)
        {
            return BadRequest("Auto-update is not enabled for this node");
        }

        // Trigger the job
        await _autoUpdateService.CheckAndApplyUpdatesAsync();

        _audit.TryEnqueue(AuditEventFactory.CreateHttp(
            kind: "activity",
            eventName: "autoupdate.check.triggered",
            httpContext: HttpContext,
            success: true,
            statusCode: 202,
            nodeId: nodeId,
            category: "auto-update",
            message: "Manual update check triggered"));

        return Accepted(new { message = "Update check triggered" });
    }

    /// <summary>
    /// Approves a pending update for a specific node.
    /// </summary>
    /// <param name="nodeId">The node ID.</param>
    /// <returns>202 Accepted on success, 404 if node not found or no pending update.</returns>
    [HttpPost("{nodeId:guid}/approve")]
    public async Task<IActionResult> ApprovePendingUpdate(Guid nodeId)
    {
        var node = await _dbContext.Nodes.FindAsync(nodeId);
        if (node == null)
        {
            return NotFound();
        }

        var success = await _autoUpdateService.ApprovePendingUpdateAsync(nodeId);
        if (!success)
        {
            return BadRequest("No pending update found for this node");
        }

        _audit.TryEnqueue(AuditEventFactory.CreateHttp(
            kind: "activity",
            eventName: "autoupdate.approved",
            httpContext: HttpContext,
            success: true,
            statusCode: 202,
            nodeId: nodeId,
            category: "auto-update",
            message: "Pending update approved"));

        return Accepted(new { message = "Update approved and triggered" });
    }

    /// <summary>
    /// Disables auto-update for a specific node.
    /// </summary>
    /// <param name="nodeId">The node ID.</param>
    /// <returns>204 NoContent on success, 404 if node not found.</returns>
    [HttpPost("{nodeId:guid}/disable")]
    public async Task<IActionResult> DisableAutoUpdate(Guid nodeId)
    {
        var node = await _dbContext.Nodes.FindAsync(nodeId);
        if (node == null)
        {
            return NotFound();
        }

        await _autoUpdateService.DisableAutoUpdateAsync(nodeId);

        _audit.TryEnqueue(AuditEventFactory.CreateHttp(
            kind: "audit",
            eventName: "autoupdate.disabled",
            httpContext: HttpContext,
            success: true,
            statusCode: 204,
            nodeId: nodeId,
            category: "auto-update",
            message: "Auto-update disabled"));

        return NoContent();
    }

    /// <summary>
    /// Triggers a global auto-update check for all nodes.
    /// </summary>
    /// <returns>202 Accepted on success.</returns>
    [HttpPost("trigger-global")]
    public async Task<IActionResult> TriggerGlobalCheck()
    {
        await _scheduler.TriggerAutoUpdateJobAsync();

        _audit.TryEnqueue(AuditEventFactory.CreateHttp(
            kind: "activity",
            eventName: "autoupdate.global.triggered",
            httpContext: HttpContext,
            success: true,
            statusCode: 202,
            category: "auto-update",
            message: "Global auto-update check triggered"));

        return Accepted(new { message = "Global auto-update check triggered" });
    }

    /// <summary>
    /// Gets the status of all nodes with auto-update enabled.
    /// </summary>
    /// <returns>List of auto-update status for all nodes.</returns>
    [HttpGet("status")]
    public async Task<ActionResult<IEnumerable<NodeAutoUpdateStatusDto>>> GetGlobalStatus()
    {
        var nodesWithAutoUpdate = await _dbContext.Nodes
            .Join(
                _dbContext.NodeSettings.Where(s => s.Key == SettingKeys.AutoUpdate.Enabled && s.Value == "true"),
                node => node.Id,
                setting => setting.NodeId,
                (node, _) => node)
            .OrderByDescending(n => n.LastSeen)
            .ToListAsync();

        var result = new List<NodeAutoUpdateStatusDto>();

        foreach (var node in nodesWithAutoUpdate)
        {
            var settings = await _autoUpdateService.GetNodeAutoUpdateSettingsAsync(_dbContext, node.Id);

            result.Add(new NodeAutoUpdateStatusDto
            {
                NodeId = node.Id,
                Hostname = node.Hostname,
                Status = node.Status.ToString(),
                AgentVersion = node.AgentVersion,
                AutoUpdateEnabled = settings.IsEnabled,
                PendingVersion = settings.PendingVersion,
                LastCheckAt = settings.LastCheckAt,
                LastUpdateAt = settings.LastUpdateAt,
                FailureCount = settings.FailureCount,
                LastError = settings.LastError
            });
        }

        return Ok(result);
    }

    /// <summary>
    /// Helper method to upsert a node setting.
    /// </summary>
    private async Task UpsertNodeSettingAsync(Guid nodeId, string key, string? value)
    {
        var setting = await _dbContext.NodeSettings.FindAsync(new object[] { nodeId, key });
        if (setting == null)
        {
            _dbContext.NodeSettings.Add(new NodeSetting
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
        await _dbContext.SaveChangesAsync();
    }
}

/// <summary>
/// DTO for auto-update settings.
/// </summary>
public record AutoUpdateSettingsDto
{
    public Guid NodeId { get; init; }
    public bool Enabled { get; init; }
    public string Channel { get; init; } = "stable";
    public string? MaintenanceWindow { get; init; }
    public string ApprovalMode { get; init; } = "manual";
    public DateTime? LastCheckAt { get; init; }
    public DateTime? LastUpdateAt { get; init; }
    public int FailureCount { get; init; }
    public string? PendingVersion { get; init; }
    public string? LastError { get; init; }
    public bool DisableDiscordNotification { get; init; }
    public bool DiscordNotificationsAvailable { get; init; }
}

/// <summary>
/// Request DTO for updating auto-update settings.
/// </summary>
public record UpdateAutoUpdateSettingsRequest
{
    public bool Enabled { get; init; }
    public string? Channel { get; init; }
    public string? MaintenanceWindow { get; init; }
    public string ApprovalMode { get; init; } = "manual";
    public bool? DisableDiscordNotification { get; init; }
}

/// <summary>
/// DTO for node auto-update status.
/// </summary>
public record NodeAutoUpdateStatusDto
{
    public Guid NodeId { get; init; }
    public string Hostname { get; init; } = string.Empty;
    public string Status { get; init; } = string.Empty;
    public string? AgentVersion { get; init; }
    public bool AutoUpdateEnabled { get; init; }
    public string? PendingVersion { get; init; }
    public DateTime? LastCheckAt { get; init; }
    public DateTime? LastUpdateAt { get; init; }
    public int FailureCount { get; init; }
    public string? LastError { get; init; }
}
