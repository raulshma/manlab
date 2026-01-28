using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Authorization;
using ManLab.Server.Services;
using ManLab.Server.Services.SystemUpdate;
using ManLab.Server.Data;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Controllers;

/// <summary>
/// API controller for system update operations.
/// </summary>
[ApiController]
[Route("api/systemupdate")]
[Authorize]
public sealed class SystemUpdateController : ControllerBase
{
    private readonly SystemUpdateService _systemUpdateService;
    private readonly DataContext _db;
    private readonly ILogger<SystemUpdateController> _logger;

    public SystemUpdateController(
        SystemUpdateService systemUpdateService,
        DataContext db,
        ILogger<SystemUpdateController> logger)
    {
        _systemUpdateService = systemUpdateService;
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// GET /api/systemupdate/{nodeId}
    /// Gets system update settings for a node.
    /// </summary>
    [HttpGet("{nodeId}")]
    public async Task<ActionResult<SystemUpdateNodeSettings>> GetSettings(Guid nodeId)
    {
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound(new { error = "Node not found" });
        }

        var settings = await _systemUpdateService.GetNodeSettingsAsync(nodeId);
        return Ok(settings);
    }

    /// <summary>
    /// PUT /api/systemupdate/{nodeId}
    /// Updates system update settings for a node.
    /// </summary>
    [HttpPut("{nodeId}")]
    public async Task<ActionResult> UpdateSettings(Guid nodeId, [FromBody] SystemUpdateNodeSettings settings)
    {
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound(new { error = "Node not found" });
        }

        // Validate maintenance window format
        if (!string.IsNullOrWhiteSpace(settings.MaintenanceWindow))
        {
            var parts = settings.MaintenanceWindow.Split('-');
            if (parts.Length != 2 ||
                !TimeSpan.TryParse(parts[0], out var _) ||
                !TimeSpan.TryParse(parts[1], out var _))
            {
                return BadRequest(new { error = "Maintenance window must be in format 'HH:MM-HH:MM' (UTC)" });
            }
        }

        // Validate day of week
        if (settings.ScheduledDayOfWeek.HasValue && (settings.ScheduledDayOfWeek.Value < 0 || settings.ScheduledDayOfWeek.Value > 6))
        {
            return BadRequest(new { error = "Day of week must be between 0 (Monday) and 6 (Sunday), or null" });
        }

        // Validate check interval
        if (settings.CheckIntervalMinutes < 15)
        {
            return BadRequest(new { error = "Check interval must be at least 15 minutes" });
        }

        await _systemUpdateService.UpdateNodeSettingsAsync(nodeId, settings);
        return Ok(new { message = "Settings updated successfully" });
    }

    /// <summary>
    /// GET /api/systemupdate/{nodeId}/check
    /// Manually checks for available system updates.
    /// </summary>
    [HttpGet("{nodeId}/check")]
    public async Task<ActionResult<SystemUpdateAvailability>> CheckForUpdates(Guid nodeId)
    {
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound(new { error = "Node not found" });
        }

        var availability = await _systemUpdateService.CheckForUpdatesAsync(nodeId);
        if (availability == null)
        {
            return StatusCode(500, new { error = "Failed to check for updates" });
        }

        return Ok(availability);
    }

    /// <summary>
    /// POST /api/systemupdate/{nodeId}/create
    /// Creates a pending system update.
    /// </summary>
    [HttpPost("{nodeId}/create")]
    public async Task<ActionResult> CreateUpdate(Guid nodeId, [FromBody] CreateSystemUpdateRequest request)
    {
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound(new { error = "Node not found" });
        }

        var options = new SystemUpdateOptions
        {
            IncludeSecurityUpdates = request.IncludeSecurityUpdates ?? true,
            IncludeFeatureUpdates = request.IncludeFeatureUpdates ?? true,
            IncludeDriverUpdates = request.IncludeDriverUpdates ?? true
        };

        var updateId = await _systemUpdateService.CreatePendingUpdateAsync(nodeId, options);
        if (!updateId.HasValue)
        {
            return BadRequest(new { error = "Failed to create update - no updates available or no SSH credentials" });
        }

        return Ok(new { updateId = updateId.Value });
    }

    /// <summary>
    /// GET /api/systemupdate/updates/{updateId}
    /// Gets details of a specific update.
    /// </summary>
    [HttpGet("updates/{updateId}")]
    public async Task<ActionResult<SystemUpdateDetails>> GetUpdateDetails(Guid updateId)
    {
        var update = await _db.SystemUpdateHistories
            .Include(h => h.Node)
            .Include(h => h.Logs)
            .FirstOrDefaultAsync(h => h.Id == updateId);

        if (update == null)
        {
            return NotFound(new { error = "Update not found" });
        }

        var packages = string.IsNullOrEmpty(update.PackagesJson)
            ? new List<SystemPackage>()
            : JsonSerializer.Deserialize<List<SystemPackage>>(update.PackagesJson) ?? new List<SystemPackage>();

        var details = new SystemUpdateDetails
        {
            Id = update.Id,
            NodeId = update.NodeId,
            NodeHostname = update.Node?.Hostname,
            StartedAt = update.StartedAt,
            CompletedAt = update.CompletedAt,
            ScheduledAt = update.ScheduledAt,
            Status = update.Status,
            UpdateType = update.UpdateType,
            Packages = packages,
            RebootRequired = update.RebootRequired,
            RebootApproved = update.RebootApproved,
            RebootedAt = update.RebootedAt,
            ActorType = update.ActorType,
            ActorId = update.ActorId,
            LogCount = update.Logs.Count,
            OutputLog = update.OutputLog,
            ErrorMessage = update.ErrorMessage
        };

        return Ok(details);
    }

    /// <summary>
    /// POST /api/systemupdate/updates/{updateId}/approve
    /// Approves and executes a pending system update.
    /// </summary>
    [HttpPost("updates/{updateId}/approve")]
    public async Task<ActionResult> ApproveUpdate(Guid updateId)
    {
        var update = await _db.SystemUpdateHistories
            .AsNoTracking()
            .FirstOrDefaultAsync(h => h.Id == updateId);

        if (update == null)
        {
            return NotFound(new { error = "Update not found" });
        }

        if (update.Status != "Pending")
        {
            return BadRequest(new { error = $"Update is not in Pending state (current: {update.Status})" });
        }

        var success = await _systemUpdateService.ApproveUpdateAsync(updateId);
        if (!success)
        {
            return StatusCode(500, new { error = "Failed to approve update" });
        }

        return Ok(new { message = "Update approved and execution started" });
    }

    /// <summary>
    /// POST /api/systemupdate/updates/{updateId}/reject
    /// Rejects a pending system update.
    /// </summary>
    [HttpPost("updates/{updateId}/reject")]
    public async Task<ActionResult> RejectUpdate(Guid updateId, [FromBody] RejectUpdateRequest? request)
    {
        var update = await _db.SystemUpdateHistories
            .AsNoTracking()
            .FirstOrDefaultAsync(h => h.Id == updateId);

        if (update == null)
        {
            return NotFound(new { error = "Update not found" });
        }

        if (update.Status != "Pending")
        {
            return BadRequest(new { error = $"Update is not in Pending state (current: {update.Status})" });
        }

        var success = await _systemUpdateService.RejectUpdateAsync(updateId, request?.Reason);
        if (!success)
        {
            return StatusCode(500, new { error = "Failed to reject update" });
        }

        return Ok(new { message = "Update rejected" });
    }

    /// <summary>
    /// GET /api/systemupdate/{nodeId}/history
    /// Gets update history for a node.
    /// </summary>
    [HttpGet("{nodeId}/history")]
    public async Task<ActionResult<List<SystemUpdateHistoryItem>>> GetHistory(Guid nodeId, [FromQuery] int limit = 50)
    {
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound(new { error = "Node not found" });
        }

        var history = await _systemUpdateService.GetUpdateHistoryAsync(nodeId, Math.Min(limit, 100));

        var items = history.Select(h => new SystemUpdateHistoryItem
        {
            Id = h.Id,
            StartedAt = h.StartedAt,
            CompletedAt = h.CompletedAt,
            Status = h.Status,
            UpdateType = h.UpdateType,
            RebootRequired = h.RebootRequired,
            RebootApproved = h.RebootApproved,
            RebootedAt = h.RebootedAt,
            PackageCount = string.IsNullOrEmpty(h.PackagesJson) ? 0 :
                (JsonSerializer.Deserialize<List<SystemPackage>>(h.PackagesJson)?.Count ?? 0),
            ErrorMessage = h.ErrorMessage
        }).ToList();

        return Ok(items);
    }

    /// <summary>
    /// GET /api/systemupdate/updates/{updateId}/logs
    /// Gets detailed logs for an update.
    /// </summary>
    [HttpGet("updates/{updateId}/logs")]
    public async Task<ActionResult<List<SystemUpdateLogItem>>> GetLogs(Guid updateId)
    {
        var logs = await _systemUpdateService.GetUpdateLogsAsync(updateId);

        var items = logs.Select(l => new SystemUpdateLogItem
        {
            Id = l.Id,
            TimestampUtc = l.TimestampUtc,
            Level = l.Level,
            Message = l.Message,
            Details = l.Details
        }).ToList();

        return Ok(items);
    }

    /// <summary>
    /// POST /api/systemupdate/updates/{updateId}/reboot/approve
    /// Approves and executes a reboot for an update that requires it.
    /// </summary>
    [HttpPost("updates/{updateId}/reboot/approve")]
    public async Task<ActionResult> ApproveReboot(Guid updateId)
    {
        var update = await _db.SystemUpdateHistories
            .AsNoTracking()
            .FirstOrDefaultAsync(h => h.Id == updateId);

        if (update == null)
        {
            return NotFound(new { error = "Update not found" });
        }

        if (!update.RebootRequired)
        {
            return BadRequest(new { error = "This update does not require a reboot" });
        }

        if (update.RebootApproved)
        {
            return BadRequest(new { error = "Reboot has already been approved" });
        }

        var success = await _systemUpdateService.ApproveRebootAsync(updateId);
        if (!success)
        {
            return StatusCode(500, new { error = "Failed to execute reboot" });
        }

        return Ok(new { message = "Reboot approved and executed" });
    }
    /// <summary>
    /// POST /api/systemupdate/cleanup
    /// Manually cleans up any stuck updates (InProgress updates that are actually dead).
    /// </summary>
    [HttpPost("cleanup")]
    public async Task<ActionResult> CleanupStuckUpdates()
    {
        await _systemUpdateService.CleanupStuckUpdatesAsync();
        return Ok(new { message = "Stuck updates cleanup completed" });
    }
}

#region Request/Response Models

/// <summary>
/// Request to create a system update.
/// </summary>
public sealed record CreateSystemUpdateRequest
{
    public bool? IncludeSecurityUpdates { get; init; }
    public bool? IncludeFeatureUpdates { get; init; }
    public bool? IncludeDriverUpdates { get; init; }
}

/// <summary>
/// Request to reject a system update.
/// </summary>
public sealed record RejectUpdateRequest
{
    public string? Reason { get; init; }
}

/// <summary>
/// Detailed system update information.
/// </summary>
public sealed record SystemUpdateDetails
{
    public required Guid Id { get; init; }
    public required Guid NodeId { get; init; }
    public string? NodeHostname { get; init; }
    public required DateTime StartedAt { get; init; }
    public DateTime? CompletedAt { get; init; }
    public DateTime? ScheduledAt { get; init; }
    public required string Status { get; init; }
    public string? UpdateType { get; init; }
    public required List<SystemPackage> Packages { get; init; } = new();
    public required bool RebootRequired { get; init; }
    public required bool RebootApproved { get; init; }
    public DateTime? RebootedAt { get; init; }
    public string? ActorType { get; init; }
    public string? ActorId { get; init; }
    public required int LogCount { get; init; }
    public string? OutputLog { get; init; }
    public string? ErrorMessage { get; init; }
}

/// <summary>
/// System update history item (summary).
/// </summary>
public sealed record SystemUpdateHistoryItem
{
    public required Guid Id { get; init; }
    public required DateTime StartedAt { get; init; }
    public DateTime? CompletedAt { get; init; }
    public required string Status { get; init; }
    public string? UpdateType { get; init; }
    public required bool RebootRequired { get; init; }
    public required bool RebootApproved { get; init; }
    public DateTime? RebootedAt { get; init; }
    public required int PackageCount { get; init; }
    public string? ErrorMessage { get; init; }
}

/// <summary>
/// System update log item.
/// </summary>
public sealed record SystemUpdateLogItem
{
    public required Guid Id { get; init; }
    public required DateTime TimestampUtc { get; init; }
    public required string Level { get; init; }
    public required string Message { get; init; }
    public string? Details { get; init; }
}

#endregion
