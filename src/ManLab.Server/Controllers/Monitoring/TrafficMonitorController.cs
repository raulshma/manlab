using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Services.Monitoring;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/monitoring/traffic")]
public sealed class TrafficMonitorController : ControllerBase
{
    private readonly DataContext _db;
    private readonly MonitorJobScheduler _scheduler;
    private readonly ILogger<TrafficMonitorController> _logger;

    public TrafficMonitorController(DataContext db, MonitorJobScheduler scheduler, ILogger<TrafficMonitorController> logger)
    {
        _db = db;
        _scheduler = scheduler;
        _logger = logger;
    }

    [HttpGet("config")]
    public async Task<ActionResult<TrafficMonitorConfigDto>> GetConfig(CancellationToken ct)
    {
        var config = await _db.TrafficMonitorConfigs
            .AsNoTracking()
            .FirstOrDefaultAsync(ct)
            .ConfigureAwait(false);
        if (config is null)
        {
            return NotFound();
        }

        return Ok(MapConfig(config));
    }

    [HttpPut("config")]
    public async Task<ActionResult<TrafficMonitorConfigDto>> UpdateConfig([FromBody] TrafficMonitorConfigRequest request, CancellationToken ct)
    {
        if (!CronExpression.IsValidExpression(request.Cron))
        {
            return BadRequest("Cron expression is invalid.");
        }

        var config = await EnsureConfigAsync(ct).ConfigureAwait(false);
        config.Cron = request.Cron.Trim();
        config.Enabled = request.Enabled ?? config.Enabled;
        config.InterfaceName = string.IsNullOrWhiteSpace(request.InterfaceName)
            ? null
            : request.InterfaceName.Trim();
        config.UpdatedAt = DateTime.UtcNow;

        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        await _scheduler.ApplyTrafficMonitorScheduleAsync(config, ct).ConfigureAwait(false);

        return Ok(MapConfig(config));
    }

    [HttpGet("history")]
    public async Task<ActionResult<List<TrafficSampleDto>>> GetHistory(
        [FromQuery] int count = 360,
        [FromQuery] string? interfaceName = null,
        CancellationToken ct = default)
    {
        count = Math.Clamp(count, 1, 5000);

        var query = _db.TrafficSamples.AsNoTracking();
        if (!string.IsNullOrWhiteSpace(interfaceName))
        {
            query = query.Where(s => s.InterfaceName == interfaceName);
        }

        var samples = await query
            .OrderByDescending(s => s.TimestampUtc)
            .Take(count)
            .ToListAsync(ct)
            .ConfigureAwait(false);

        return Ok(samples.Select(MapSample).ToList());
    }

    [HttpPost("run")]
    public async Task<ActionResult> RunNow(CancellationToken ct)
    {
        var config = await _db.TrafficMonitorConfigs.FirstOrDefaultAsync(ct).ConfigureAwait(false);
        if (config is null)
        {
            return NotFound();
        }

        try
        {
            await _scheduler.TriggerTrafficMonitorAsync(config.Id, ct).ConfigureAwait(false);
            return Accepted();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to trigger traffic monitor");
            return StatusCode(500, "Failed to trigger traffic monitor");
        }
    }

    [HttpDelete("config")]
    public async Task<ActionResult> DeleteConfig(CancellationToken ct)
    {
        var config = await _db.TrafficMonitorConfigs.FirstOrDefaultAsync(ct).ConfigureAwait(false);
        if (config is null)
        {
            return NotFound();
        }

        _db.TrafficMonitorConfigs.Remove(config);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        await _scheduler.RemoveTrafficMonitorAsync(config.Id, ct).ConfigureAwait(false);

        return NoContent();
    }

    private async Task<TrafficMonitorConfig> EnsureConfigAsync(CancellationToken ct)
    {
        var config = await _db.TrafficMonitorConfigs.FirstOrDefaultAsync(ct).ConfigureAwait(false);
        if (config is not null)
        {
            return config;
        }

        config = new TrafficMonitorConfig
        {
            Cron = "*/30 * * * * ?",
            Enabled = true,
            CreatedAt = DateTime.UtcNow,
            UpdatedAt = DateTime.UtcNow
        };

        _db.TrafficMonitorConfigs.Add(config);
        await _db.SaveChangesAsync(ct).ConfigureAwait(false);
        await _scheduler.ApplyTrafficMonitorScheduleAsync(config, ct).ConfigureAwait(false);

        return config;
    }

    private static TrafficMonitorConfigDto MapConfig(TrafficMonitorConfig config) => new()
    {
        Id = config.Id,
        InterfaceName = config.InterfaceName,
        Cron = config.Cron,
        Enabled = config.Enabled,
        CreatedAt = config.CreatedAt,
        UpdatedAt = config.UpdatedAt,
        LastRunAtUtc = config.LastRunAtUtc
    };

    private static TrafficSampleDto MapSample(TrafficSample sample) => new()
    {
        Id = sample.Id,
        InterfaceName = sample.InterfaceName,
        TimestampUtc = sample.TimestampUtc,
        RxBytesPerSec = sample.RxBytesPerSec,
        TxBytesPerSec = sample.TxBytesPerSec,
        RxErrors = sample.RxErrors,
        TxErrors = sample.TxErrors,
        SpeedBps = sample.SpeedBps,
        UtilizationPercent = sample.UtilizationPercent
    };
}

public sealed record TrafficMonitorConfigRequest
{
    public string Cron { get; init; } = "*/30 * * * * ?";
    public bool? Enabled { get; init; }
    public string? InterfaceName { get; init; }
}

public sealed record TrafficMonitorConfigDto
{
    public Guid Id { get; init; }
    public string? InterfaceName { get; init; }
    public string Cron { get; init; } = string.Empty;
    public bool Enabled { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime UpdatedAt { get; init; }
    public DateTime? LastRunAtUtc { get; init; }
}

public sealed record TrafficSampleDto
{
    public long Id { get; init; }
    public string InterfaceName { get; init; } = string.Empty;
    public DateTime TimestampUtc { get; init; }
    public long? RxBytesPerSec { get; init; }
    public long? TxBytesPerSec { get; init; }
    public long? RxErrors { get; init; }
    public long? TxErrors { get; init; }
    public long? SpeedBps { get; init; }
    public float? UtilizationPercent { get; init; }
}
