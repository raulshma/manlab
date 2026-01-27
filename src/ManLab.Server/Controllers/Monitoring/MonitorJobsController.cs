using ManLab.Server.Data;
using ManLab.Server.Services.Monitoring;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace ManLab.Server.Controllers;

[ApiController]
[Route("api/monitoring/jobs")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.MonitoringView)]
public sealed class MonitorJobsController : ControllerBase
{
    private readonly DataContext _db;
    private readonly ISchedulerFactory _schedulerFactory;

    public MonitorJobsController(DataContext db, ISchedulerFactory schedulerFactory)
    {
        _db = db;
        _schedulerFactory = schedulerFactory;
    }

    [HttpGet]
    public async Task<ActionResult<List<MonitorJobSummaryDto>>> GetJobs(CancellationToken ct)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var results = new List<MonitorJobSummaryDto>();

        var httpConfigs = await _db.HttpMonitorConfigs.AsNoTracking().ToListAsync(ct).ConfigureAwait(false);
        foreach (var config in httpConfigs)
        {
            var trigger = await scheduler.GetTrigger(MonitorJobScheduler.GetHttpTriggerKey(config.Id), ct).ConfigureAwait(false);
            results.Add(new MonitorJobSummaryDto
            {
                Id = config.Id,
                Type = "http",
                Name = config.Name,
                Schedule = config.Cron,
                Enabled = config.Enabled,
                LastRunAtUtc = trigger?.GetPreviousFireTimeUtc()?.UtcDateTime ?? config.LastRunAtUtc,
                NextRunAtUtc = trigger?.GetNextFireTimeUtc()?.UtcDateTime
            });
        }

        var trafficConfigs = await _db.TrafficMonitorConfigs.AsNoTracking().ToListAsync(ct).ConfigureAwait(false);
        foreach (var config in trafficConfigs)
        {
            var trigger = await scheduler.GetTrigger(MonitorJobScheduler.GetTrafficTriggerKey(config.Id), ct).ConfigureAwait(false);
            results.Add(new MonitorJobSummaryDto
            {
                Id = config.Id,
                Type = "traffic",
                Name = string.IsNullOrWhiteSpace(config.InterfaceName) ? "Traffic Monitor" : $"Traffic ({config.InterfaceName})",
                Schedule = config.Cron,
                Enabled = config.Enabled,
                LastRunAtUtc = trigger?.GetPreviousFireTimeUtc()?.UtcDateTime ?? config.LastRunAtUtc,
                NextRunAtUtc = trigger?.GetNextFireTimeUtc()?.UtcDateTime
            });
        }

        return Ok(results.OrderBy(r => r.Type).ThenBy(r => r.Name).ToList());
    }
}

public sealed record MonitorJobSummaryDto
{
    public Guid Id { get; init; }
    public string Type { get; init; } = string.Empty;
    public string Name { get; init; } = string.Empty;
    public string Schedule { get; init; } = string.Empty;
    public bool Enabled { get; init; }
    public DateTime? LastRunAtUtc { get; init; }
    public DateTime? NextRunAtUtc { get; init; }
}
