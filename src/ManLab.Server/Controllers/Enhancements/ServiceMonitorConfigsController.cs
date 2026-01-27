using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Data.Enums;
using ManLab.Shared.Dtos;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/devices/{nodeId:guid}/service-monitor-configs")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringView)]
public sealed class ServiceMonitorConfigsController : ControllerBase
{
    private const int MaxServiceNameChars = 256;

    private readonly DataContext _db;
    private readonly ILogger<ServiceMonitorConfigsController> _logger;

    public ServiceMonitorConfigsController(DataContext db, ILogger<ServiceMonitorConfigsController> logger)
    {
        _db = db;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<ServiceMonitorConfigDto>>> List(Guid nodeId)
    {
        var nodeExists = await _db.Nodes.AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _db.ServiceMonitorConfigs
            .AsNoTracking()
            .Where(c => c.NodeId == nodeId)
            .OrderBy(c => c.ServiceName)
            .Select(c => new ServiceMonitorConfigDto(
                c.Id,
                c.NodeId,
                c.ServiceName,
                c.Enabled,
                c.CreatedAt,
                c.UpdatedAt))
            .ToListAsync();

        return Ok(items);
    }

    [HttpPost]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult<ServiceMonitorConfigDto>> Create(Guid nodeId, [FromBody] UpsertServiceMonitorConfigRequest request)
    {
        var nodeExists = await _db.Nodes.AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound();
        }

        var serviceName = (request.ServiceName ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(serviceName))
        {
            return BadRequest("serviceName is required");
        }

        if (serviceName.Length > MaxServiceNameChars)
        {
            return BadRequest($"serviceName too long (max {MaxServiceNameChars})");
        }

        var exists = await _db.ServiceMonitorConfigs.AnyAsync(c => c.NodeId == nodeId && c.ServiceName == serviceName);
        if (exists)
        {
            return Conflict(new { message = "A config for this service already exists." });
        }

        var now = DateTime.UtcNow;
        var entity = new ServiceMonitorConfig
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            ServiceName = serviceName,
            Enabled = request.Enabled ?? true,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.ServiceMonitorConfigs.Add(entity);
        await _db.SaveChangesAsync();

        return CreatedAtAction(nameof(List), new { nodeId }, new ServiceMonitorConfigDto(
            entity.Id,
            entity.NodeId,
            entity.ServiceName,
            entity.Enabled,
            entity.CreatedAt,
            entity.UpdatedAt));
    }

    [HttpPut("{configId:guid}")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult<ServiceMonitorConfigDto>> Update(Guid nodeId, Guid configId, [FromBody] UpsertServiceMonitorConfigRequest request)
    {
        var entity = await _db.ServiceMonitorConfigs.FirstOrDefaultAsync(c => c.Id == configId && c.NodeId == nodeId);
        if (entity is null)
        {
            return NotFound();
        }

        if (!string.IsNullOrWhiteSpace(request.ServiceName))
        {
            var serviceName = request.ServiceName.Trim();
            if (serviceName.Length > MaxServiceNameChars)
            {
                return BadRequest($"serviceName too long (max {MaxServiceNameChars})");
            }

            if (!string.Equals(entity.ServiceName, serviceName, StringComparison.Ordinal))
            {
                var conflict = await _db.ServiceMonitorConfigs.AnyAsync(c => c.NodeId == nodeId && c.ServiceName == serviceName && c.Id != entity.Id);
                if (conflict)
                {
                    return Conflict(new { message = "A config for this service already exists." });
                }

                entity.ServiceName = serviceName;
            }
        }

        if (request.Enabled.HasValue)
        {
            entity.Enabled = request.Enabled.Value;
        }

        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new ServiceMonitorConfigDto(
            entity.Id,
            entity.NodeId,
            entity.ServiceName,
            entity.Enabled,
            entity.CreatedAt,
            entity.UpdatedAt));
    }

    [HttpDelete("{configId:guid}")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<IActionResult> Delete(Guid nodeId, Guid configId)
    {
        var entity = await _db.ServiceMonitorConfigs.FirstOrDefaultAsync(c => c.Id == configId && c.NodeId == nodeId);
        if (entity is null)
        {
            return NotFound();
        }

        _db.ServiceMonitorConfigs.Remove(entity);
        await _db.SaveChangesAsync();

        return NoContent();
    }

    /// <summary>
    /// Requests a service status refresh on the agent by enqueueing a service.status command.
    /// Payload: { "services": ["nginx", "ssh"] }
    /// </summary>
    [HttpPost("refresh")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult<QueuedCommandResponse>> RequestRefresh(Guid nodeId)
    {
        var nodeExists = await _db.Nodes.AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound();
        }

        var services = await _db.ServiceMonitorConfigs
            .AsNoTracking()
            .Where(c => c.NodeId == nodeId && c.Enabled)
            .OrderBy(c => c.ServiceName)
            .Select(c => c.ServiceName)
            .ToListAsync();

        var payload = JsonSerializer.Serialize(new { services });

        var cmd = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            CommandType = CommandType.ServiceStatus,
            Payload = payload,
            Status = CommandStatus.Queued,
            CreatedAt = DateTime.UtcNow
        };

        _db.CommandQueue.Add(cmd);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Queued service.status refresh command {CommandId} for node {NodeId} ({ServiceCount} services)", cmd.Id, nodeId, services.Count);

        return Accepted(new QueuedCommandResponse(cmd.Id));
    }

    public sealed record ServiceMonitorConfigDto(
        Guid Id,
        Guid NodeId,
        string ServiceName,
        bool Enabled,
        DateTime CreatedAt,
        DateTime UpdatedAt);

    public sealed record UpsertServiceMonitorConfigRequest(string? ServiceName, bool? Enabled);

    public sealed record QueuedCommandResponse(Guid CommandId);
}
