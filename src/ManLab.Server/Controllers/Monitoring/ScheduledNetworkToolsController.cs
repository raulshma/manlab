using System.Text.Json;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Services.Monitoring;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/monitoring/network-tools")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringView)]
public sealed class ScheduledNetworkToolsController : ControllerBase
{
    private static readonly HashSet<string> SupportedToolTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "ping",
        "dns-lookup",
        "ssl-inspect",
        "public-ip",
        "traceroute"
    };

    private readonly DataContext _db;
    private readonly MonitorJobScheduler _scheduler;
    private readonly IAuthorizationService _authorizationService;
    private readonly ILogger<ScheduledNetworkToolsController> _logger;

    public ScheduledNetworkToolsController(
        DataContext db,
        MonitorJobScheduler scheduler,
        IAuthorizationService authorizationService,
        ILogger<ScheduledNetworkToolsController> logger)
    {
        _db = db;
        _scheduler = scheduler;
        _authorizationService = authorizationService;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<List<ScheduledNetworkToolConfigDto>>> GetAll(CancellationToken ct)
    {
        var items = await _db.ScheduledNetworkToolConfigs
            .AsNoTracking()
            .OrderBy(c => c.Name)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return Ok(items.Select(MapConfig).ToList());
    }

    [HttpGet("{id:guid}")]
    public async Task<ActionResult<ScheduledNetworkToolConfigDto>> GetById(Guid id, CancellationToken ct)
    {
        var config = await _db.ScheduledNetworkToolConfigs
            .AsNoTracking()
            .FirstOrDefaultAsync(c => c.Id == id, ct)
            .ConfigureAwait(false);

        if (config is null)
        {
            return NotFound();
        }

        return Ok(MapConfig(config));
    }

    [HttpPost]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult<ScheduledNetworkToolConfigDto>> Create([FromBody] ScheduledNetworkToolConfigRequest request, CancellationToken ct)
    {
        var validationError = ValidateRequest(request);
        if (validationError is not null)
        {
            return BadRequest(validationError);
        }

        var authorizationResult = await EnsureToolPermissionAsync(request.ToolType);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        if (!CronExpression.IsValidExpression(request.Cron))
        {
            return BadRequest("Cron expression is invalid.");
        }

        var config = new ScheduledNetworkToolConfig
        {
            Name = request.Name.Trim(),
            ToolType = request.ToolType.Trim().ToLowerInvariant(),
            Target = string.IsNullOrWhiteSpace(request.Target) ? null : request.Target.Trim(),
            ParametersJson = request.Parameters.HasValue ? request.Parameters.Value.GetRawText() : null,
            Cron = request.Cron.Trim(),
            Enabled = request.Enabled ?? true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.ScheduledNetworkToolConfigs.Add(config);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);

        await _scheduler.ApplyScheduledToolScheduleAsync(config, ct).ConfigureAwait(false);

        return Ok(MapConfig(config));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult<ScheduledNetworkToolConfigDto>> Update(Guid id, [FromBody] ScheduledNetworkToolConfigRequest request, CancellationToken ct)
    {
        var config = await _db.ScheduledNetworkToolConfigs.FirstOrDefaultAsync(c => c.Id == id, ct).ConfigureAwait(false);
        if (config is null)
        {
            return NotFound();
        }

        var validationError = ValidateRequest(request);
        if (validationError is not null)
        {
            return BadRequest(validationError);
        }

        var authorizationResult = await EnsureToolPermissionAsync(request.ToolType);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        if (!CronExpression.IsValidExpression(request.Cron))
        {
            return BadRequest("Cron expression is invalid.");
        }

        config.Name = request.Name.Trim();
        config.ToolType = request.ToolType.Trim().ToLowerInvariant();
        config.Target = string.IsNullOrWhiteSpace(request.Target) ? null : request.Target.Trim();
        config.ParametersJson = request.Parameters.HasValue ? request.Parameters.Value.GetRawText() : null;
        config.Cron = request.Cron.Trim();
        if (request.Enabled.HasValue)
        {
            config.Enabled = request.Enabled.Value;
        }
        config.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        await _scheduler.ApplyScheduledToolScheduleAsync(config, ct).ConfigureAwait(false);

        return Ok(MapConfig(config));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult> Delete(Guid id, CancellationToken ct)
    {
        var config = await _db.ScheduledNetworkToolConfigs.FirstOrDefaultAsync(c => c.Id == id, ct).ConfigureAwait(false);
        if (config is null)
        {
            return NotFound();
        }

        _db.ScheduledNetworkToolConfigs.Remove(config);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);

        await _scheduler.RemoveScheduledToolAsync(id, ct).ConfigureAwait(false);
        return NoContent();
    }

    [HttpPost("{id:guid}/run")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult> RunNow(Guid id, CancellationToken ct)
    {
        var exists = await _db.ScheduledNetworkToolConfigs.AnyAsync(c => c.Id == id, ct).ConfigureAwait(false);
        if (!exists)
        {
            return NotFound();
        }

        var toolType = await _db.ScheduledNetworkToolConfigs
            .AsNoTracking()
            .Where(c => c.Id == id)
            .Select(c => c.ToolType)
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);

        if (string.IsNullOrWhiteSpace(toolType))
        {
            return NotFound();
        }

        var authorizationResult = await EnsureToolPermissionAsync(toolType);
        if (authorizationResult is not null)
        {
            return authorizationResult;
        }

        try
        {
            await _scheduler.TriggerScheduledToolAsync(id, ct).ConfigureAwait(false);
            return Accepted();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to trigger scheduled network tool {ScheduleId}", id);
            return StatusCode(500, "Failed to trigger scheduled network tool");
        }
    }

    private static string? ValidateRequest(ScheduledNetworkToolConfigRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return "Name is required.";
        }

        if (string.IsNullOrWhiteSpace(request.ToolType))
        {
            return "ToolType is required.";
        }

        if (!SupportedToolTypes.Contains(request.ToolType))
        {
            return $"ToolType '{request.ToolType}' is not supported.";
        }

        if (!Permissions.TryGetNetworkToolPermission(request.ToolType, out _))
        {
            return $"ToolType '{request.ToolType}' does not map to a permission.";
        }

        if (RequiresTarget(request.ToolType) && string.IsNullOrWhiteSpace(request.Target))
        {
            return "Target is required for this tool type.";
        }

        return null;
    }

    private async Task<ActionResult?> EnsureToolPermissionAsync(string toolType)
    {
        if (!Permissions.TryGetNetworkToolPermission(toolType, out var permission))
        {
            return BadRequest($"ToolType '{toolType}' does not map to a permission.");
        }

        var result = await _authorizationService.AuthorizeAsync(
            User,
            policyName: Permissions.PolicyFor(permission));

        return result.Succeeded ? null : Forbid();
    }

    private static bool RequiresTarget(string toolType)
    {
        return !string.Equals(toolType, "public-ip", StringComparison.OrdinalIgnoreCase);
    }

    private static ScheduledNetworkToolConfigDto MapConfig(ScheduledNetworkToolConfig config) => new()
    {
        Id = config.Id,
        Name = config.Name,
        ToolType = config.ToolType,
        Target = config.Target,
        ParametersJson = config.ParametersJson,
        Cron = config.Cron,
        Enabled = config.Enabled,
        CreatedAt = config.CreatedAt,
        UpdatedAt = config.UpdatedAt,
        LastRunAtUtc = config.LastRunAtUtc,
        LastSuccessAtUtc = config.LastSuccessAtUtc
    };
}

public sealed record ScheduledNetworkToolConfigRequest
{
    public string Name { get; init; } = string.Empty;
    public string ToolType { get; init; } = string.Empty;
    public string? Target { get; init; }
    public JsonElement? Parameters { get; init; }
    public string Cron { get; init; } = "*/60 * * * * ?";
    public bool? Enabled { get; init; }
}

public sealed record ScheduledNetworkToolConfigDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string ToolType { get; init; } = string.Empty;
    public string? Target { get; init; }
    public string? ParametersJson { get; init; }
    public string Cron { get; init; } = string.Empty;
    public bool Enabled { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public DateTime? LastRunAtUtc { get; init; }
    public DateTime? LastSuccessAtUtc { get; init; }
}
