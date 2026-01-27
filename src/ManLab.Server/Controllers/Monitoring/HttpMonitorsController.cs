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
[Route("api/monitoring/http")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringView)]
public sealed class HttpMonitorsController : ControllerBase
{
    private readonly DataContext _db;
    private readonly MonitorJobScheduler _scheduler;
    private readonly ILogger<HttpMonitorsController> _logger;

    public HttpMonitorsController(DataContext db, MonitorJobScheduler scheduler, ILogger<HttpMonitorsController> logger)
    {
        _db = db;
        _scheduler = scheduler;
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<List<HttpMonitorConfigDto>>> GetAll(CancellationToken ct)
    {
        var items = await _db.HttpMonitorConfigs
            .AsNoTracking()
            .OrderBy(c => c.Name)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return Ok(items.Select(MapConfig).ToList());
    }

    [HttpGet("{id:guid}/history")]
    public async Task<ActionResult<List<HttpMonitorCheckDto>>> GetHistory(Guid id, [FromQuery] int count = 200, CancellationToken ct = default)
    {
        count = Math.Clamp(count, 1, 2000);
        var items = await _db.HttpMonitorChecks
            .AsNoTracking()
            .Where(c => c.MonitorId == id)
            .OrderByDescending(c => c.TimestampUtc)
            .Take(count)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return Ok(items.Select(MapCheck).ToList());
    }

    [HttpPost]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult<HttpMonitorConfigDto>> Create([FromBody] HttpMonitorConfigRequest request, CancellationToken ct)
    {
        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
        {
            return BadRequest("Url must be a valid absolute URL.");
        }

        if (!CronExpression.IsValidExpression(request.Cron))
        {
            return BadRequest("Cron expression is invalid.");
        }

        var config = new HttpMonitorConfig
        {
            Name = request.Name.Trim(),
            Url = request.Url.Trim(),
            Method = string.IsNullOrWhiteSpace(request.Method) ? "GET" : request.Method.Trim().ToUpperInvariant(),
            ExpectedStatus = request.ExpectedStatus,
            BodyContains = string.IsNullOrWhiteSpace(request.BodyContains) ? null : request.BodyContains.Trim(),
            TimeoutMs = Math.Clamp(request.TimeoutMs ?? 5000, 500, 30000),
            Cron = request.Cron.Trim(),
            Enabled = request.Enabled ?? true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.HttpMonitorConfigs.Add(config);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);

        await _scheduler.ApplyHttpMonitorScheduleAsync(config, ct).ConfigureAwait(false);

        return Ok(MapConfig(config));
    }

    [HttpPut("{id:guid}")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult<HttpMonitorConfigDto>> Update(Guid id, [FromBody] HttpMonitorConfigRequest request, CancellationToken ct)
    {
        var config = await _db.HttpMonitorConfigs.FirstOrDefaultAsync(c => c.Id == id, ct).ConfigureAwait(false);
        if (config is null)
        {
            return NotFound();
        }

        if (!Uri.TryCreate(request.Url, UriKind.Absolute, out _))
        {
            return BadRequest("Url must be a valid absolute URL.");
        }

        if (!CronExpression.IsValidExpression(request.Cron))
        {
            return BadRequest("Cron expression is invalid.");
        }

        config.Name = request.Name.Trim();
        config.Url = request.Url.Trim();
        config.Method = string.IsNullOrWhiteSpace(request.Method) ? "GET" : request.Method.Trim().ToUpperInvariant();
        config.ExpectedStatus = request.ExpectedStatus;
        config.BodyContains = string.IsNullOrWhiteSpace(request.BodyContains) ? null : request.BodyContains.Trim();
        config.TimeoutMs = Math.Clamp(request.TimeoutMs ?? 5000, 500, 30000);
        config.Cron = request.Cron.Trim();
        if (request.Enabled.HasValue)
        {
            config.Enabled = request.Enabled.Value;
        }
        config.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        await _scheduler.ApplyHttpMonitorScheduleAsync(config, ct).ConfigureAwait(false);

        return Ok(MapConfig(config));
    }

    [HttpDelete("{id:guid}")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult> Delete(Guid id, CancellationToken ct)
    {
        var config = await _db.HttpMonitorConfigs.FirstOrDefaultAsync(c => c.Id == id, ct).ConfigureAwait(false);
        if (config is null)
        {
            return NotFound();
        }

        _db.HttpMonitorConfigs.Remove(config);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);

        await _scheduler.RemoveHttpMonitorAsync(id, ct).ConfigureAwait(false);

        return NoContent();
    }

    [HttpPost("{id:guid}/run")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringManage)]
    public async Task<ActionResult> RunNow(Guid id, CancellationToken ct)
    {
        var exists = await _db.HttpMonitorConfigs.AnyAsync(c => c.Id == id, ct).ConfigureAwait(false);
        if (!exists)
        {
            return NotFound();
        }

        try
        {
            await _scheduler.TriggerHttpMonitorAsync(id, ct).ConfigureAwait(false);
            return Accepted();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to trigger HTTP monitor {MonitorId}", id);
            return StatusCode(500, "Failed to trigger monitor");
        }
    }

    private static HttpMonitorConfigDto MapConfig(HttpMonitorConfig config) => new()
    {
        Id = config.Id,
        Name = config.Name,
        Url = config.Url,
        Method = config.Method,
        ExpectedStatus = config.ExpectedStatus,
        BodyContains = config.BodyContains,
        TimeoutMs = config.TimeoutMs,
        Cron = config.Cron,
        Enabled = config.Enabled,
        CreatedAt = config.CreatedAt,
        UpdatedAt = config.UpdatedAt,
        LastRunAtUtc = config.LastRunAtUtc,
        LastSuccessAtUtc = config.LastSuccessAtUtc
    };

    private static HttpMonitorCheckDto MapCheck(HttpMonitorCheck check) => new()
    {
        Id = check.Id,
        MonitorId = check.MonitorId,
        TimestampUtc = check.TimestampUtc,
        StatusCode = check.StatusCode,
        Success = check.Success,
        ResponseTimeMs = check.ResponseTimeMs,
        KeywordMatched = check.KeywordMatched,
        SslDaysRemaining = check.SslDaysRemaining,
        ErrorMessage = check.ErrorMessage
    };
}

public sealed record HttpMonitorConfigRequest
{
    public string Name { get; init; } = string.Empty;
    public string Url { get; init; } = string.Empty;
    public string? Method { get; init; }
    public int? ExpectedStatus { get; init; }
    public string? BodyContains { get; init; }
    public int? TimeoutMs { get; init; }
    public string Cron { get; init; } = "*/60 * * * * ?";
    public bool? Enabled { get; init; }
}

public sealed record HttpMonitorConfigDto
{
    public Guid Id { get; init; }
    public string Name { get; init; } = string.Empty;
    public string Url { get; init; } = string.Empty;
    public string? Method { get; init; }
    public int? ExpectedStatus { get; init; }
    public string? BodyContains { get; init; }
    public int TimeoutMs { get; init; }
    public string Cron { get; init; } = string.Empty;
    public bool Enabled { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public DateTime? LastRunAtUtc { get; init; }
    public DateTime? LastSuccessAtUtc { get; init; }
}

public sealed record HttpMonitorCheckDto
{
    public long Id { get; init; }
    public Guid MonitorId { get; init; }
    public DateTime TimestampUtc { get; init; }
    public int? StatusCode { get; init; }
    public bool Success { get; init; }
    public int ResponseTimeMs { get; init; }
    public bool? KeywordMatched { get; init; }
    public int? SslDaysRemaining { get; init; }
    public string? ErrorMessage { get; init; }
}
