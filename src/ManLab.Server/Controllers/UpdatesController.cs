using ManLab.Server.Constants;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Security.Claims;

namespace ManLab.Server.Controllers;

/// <summary>
/// Controller for managing pending updates (agent and system).
/// </summary>
[ApiController]
[Route("api/[controller]")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.DevicesManage)]
public class UpdatesController : ControllerBase
{
    private readonly DataContext _db;
    private readonly ILogger<UpdatesController> _logger;

    public UpdatesController(DataContext db, ILogger<UpdatesController> logger)
    {
        _db = db;
        _logger = logger;
    }

    /// <summary>
    /// Gets all pending updates (agent and system) for the current user.
    /// </summary>
    [HttpGet("pending")]
    public async Task<ActionResult<PendingUpdatesSummary>> GetPendingUpdates(CancellationToken cancellationToken)
    {
        // Get username from token (the token stores username, not user ID)
        var username = User.FindFirstValue(ClaimTypes.Name);
        if (string.IsNullOrEmpty(username))
        {
            _logger.LogWarning("GetPendingUpdates: Username not found in token");
            return Unauthorized("Username not found in token");
        }

        // Get nodes the user has permission to view
        var userNodeIds = await GetUserAccessibleNodeIdsAsync(username, cancellationToken);
        _logger.LogInformation("GetPendingUpdates: User {Username} has access to {NodeCount} nodes", username, userNodeIds.Count);

        // Get pending agent updates - fetch data first, then project
        var pendingAgentUpdatesQuery = _db.NodeSettings
            .Where(s => s.Key == SettingKeys.AutoUpdate.PendingVersion && s.Value != null)
            .Join(_db.Nodes, s => s.NodeId, n => n.Id, (setting, node) => new { setting, node })
            .Where(x => userNodeIds.Contains(x.node.Id))
            .Select(x => new
            {
                NodeId = x.node.Id,
                Hostname = x.node.Hostname,
                AgentVersion = x.node.AgentVersion,
                PendingVersion = x.setting.Value,
                NodeIdForLastCheck = x.node.Id
            })
            .ToListAsync(cancellationToken);

        var agentData = await pendingAgentUpdatesQuery;

        // Fetch LastCheckAt separately for each node
        var nodeIds = agentData.Select(x => x.NodeId).ToList();
        var lastCheckAtValues = await _db.NodeSettings
            .Where(s => nodeIds.Contains(s.NodeId) && s.Key == SettingKeys.AutoUpdate.LastCheckAt)
            .Select(s => new { s.NodeId, s.Value })
            .ToDictionaryAsync(x => x.NodeId, x => x.Value, cancellationToken);

        var pendingAgentUpdates = agentData.Select(x => new PendingAgentUpdate(
            x.NodeId,
            x.Hostname,
            x.AgentVersion ?? "unknown",
            x.PendingVersion ?? "",
            lastCheckAtValues.GetValueOrDefault(x.NodeId)
        )).ToList();

        // Get pending system updates - fetch data first, then process JSON in memory
        var pendingSystemUpdatesData = await _db.SystemUpdateHistories
            .Where(h => h.Status == "Pending" && userNodeIds.Contains(h.NodeId))
            .Join(_db.Nodes, h => h.NodeId, n => n.Id, (history, node) => new { history, node })
            .Select(x => new
            {
                UpdateId = x.history.Id,
                NodeId = x.node.Id,
                Hostname = x.node.Hostname,
                UpdateType = x.history.UpdateType,
                StartedAt = x.history.StartedAt,
                PackagesJson = x.history.PackagesJson
            })
            .ToListAsync(cancellationToken);

        var pendingSystemUpdates = pendingSystemUpdatesData.Select(x => new PendingSystemUpdate(
            x.UpdateId,
            x.NodeId,
            x.Hostname,
            x.UpdateType ?? "Unknown",
            x.StartedAt,
            !string.IsNullOrEmpty(x.PackagesJson) ?
                System.Text.Json.JsonDocument.Parse(x.PackagesJson).RootElement.GetArrayLength() : 0
        )).ToList();

        var summary = new PendingUpdatesSummary(
            pendingAgentUpdates.Count + pendingSystemUpdates.Count,
            pendingAgentUpdates,
            pendingSystemUpdates
        );

        _logger.LogInformation("GetPendingUpdates: Returning {TotalCount} pending updates ({AgentCount} agent, {SystemCount} system)",
            summary.TotalCount, pendingAgentUpdates.Count, pendingSystemUpdates.Count);

        return Ok(summary);
    }

    /// <summary>
    /// Gets the list of node IDs the current user has access to.
    /// Since the controller requires devices.manage permission, all users who reach this
    /// point can see all nodes.
    /// </summary>
    private async Task<List<Guid>> GetUserAccessibleNodeIdsAsync(string username, CancellationToken cancellationToken)
    {
        // The controller-level [Authorize] attribute ensures only users with devices.manage
        // permission can reach this endpoint, so they can see all nodes.
        _logger.LogInformation("GetUserAccessibleNodeIdsAsync: User {Username} has devices.manage permission, granting access to all nodes", username);

        return await _db.Nodes
            .AsNoTracking()
            .Select(n => n.Id)
            .ToListAsync(cancellationToken);
    }
}

#region DTOs

/// <summary>
/// Summary of pending updates.
/// </summary>
public record PendingUpdatesSummary(
    int TotalCount,
    List<PendingAgentUpdate> AgentUpdates,
    List<PendingSystemUpdate> SystemUpdates
);

/// <summary>
/// Pending agent update information.
/// </summary>
public record PendingAgentUpdate(
    Guid NodeId,
    string Hostname,
    string CurrentVersion,
    string PendingVersion,
    string? LastCheckAt
);

/// <summary>
/// Pending system update information.
/// </summary>
public record PendingSystemUpdate(
    Guid UpdateId,
    Guid NodeId,
    string Hostname,
    string UpdateType,
    DateTime CreatedAt,
    int PackageCount
);

#endregion
