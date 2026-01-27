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

        // HTTP monitors
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

        // Traffic monitors
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

        // Scheduled network tools
        var networkToolConfigs = await _db.ScheduledNetworkToolConfigs.AsNoTracking().ToListAsync(ct).ConfigureAwait(false);
        foreach (var config in networkToolConfigs)
        {
            var trigger = await scheduler.GetTrigger(MonitorJobScheduler.GetScheduledToolTriggerKey(config.Id), ct).ConfigureAwait(false);
            results.Add(new MonitorJobSummaryDto
            {
                Id = config.Id,
                Type = "network-tool",
                Name = config.Name,
                Schedule = config.Cron,
                Enabled = config.Enabled,
                LastRunAtUtc = trigger?.GetPreviousFireTimeUtc()?.UtcDateTime ?? config.LastRunAtUtc,
                NextRunAtUtc = trigger?.GetNextFireTimeUtc()?.UtcDateTime
            });
        }

        // System update job (global)
        var systemUpdateJobKey = new JobKey("global-system-update", "system-update");
        var systemUpdateTriggerKey = new TriggerKey("global-system-update-trigger", "system-update");
        if (await scheduler.CheckExists(systemUpdateJobKey, ct).ConfigureAwait(false))
        {
            var trigger = await scheduler.GetTrigger(systemUpdateTriggerKey, ct).ConfigureAwait(false);
            var cronExpression = trigger is ICronTrigger cronTrigger
                ? cronTrigger.CronExpressionString ?? "0 0 */6 * * ?"
                : "0 0 */6 * * ?";
            results.Add(new MonitorJobSummaryDto
            {
                Id = Guid.Empty, // System job has no entity ID
                Type = "system-update",
                Name = "System Updates",
                Schedule = cronExpression,
                Enabled = true,
                LastRunAtUtc = trigger?.GetPreviousFireTimeUtc()?.UtcDateTime,
                NextRunAtUtc = trigger?.GetNextFireTimeUtc()?.UtcDateTime
            });
        }

        // Auto update job (global)
        var autoUpdateJobKey = new JobKey("global-auto-update", "autoupdate");
        var autoUpdateTriggerKey = new TriggerKey("global-auto-update-trigger", "autoupdate");
        if (await scheduler.CheckExists(autoUpdateJobKey, ct).ConfigureAwait(false))
        {
            var trigger = await scheduler.GetTrigger(autoUpdateTriggerKey, ct).ConfigureAwait(false);
            var cronExpression = trigger is ICronTrigger cronTrigger
                ? cronTrigger.CronExpressionString ?? "0 */15 * * * ?"
                : "0 */15 * * * ?";
            results.Add(new MonitorJobSummaryDto
            {
                Id = Guid.Empty, // System job has no entity ID
                Type = "agent-update",
                Name = "Agent Updates",
                Schedule = cronExpression,
                Enabled = true,
                LastRunAtUtc = trigger?.GetPreviousFireTimeUtc()?.UtcDateTime,
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
