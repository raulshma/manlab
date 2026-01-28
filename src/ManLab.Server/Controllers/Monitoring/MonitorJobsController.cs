using ManLab.Server.Constants;
using ManLab.Server.Data;
using ManLab.Server.Services;
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
    private readonly AutoUpdateScheduler _autoUpdateScheduler;
    private readonly SystemUpdateScheduler _systemUpdateScheduler;
    private readonly ISettingsService _settings;

    public MonitorJobsController(
        DataContext db, 
        ISchedulerFactory schedulerFactory,
        AutoUpdateScheduler autoUpdateScheduler,
        SystemUpdateScheduler systemUpdateScheduler,
        ISettingsService settings)
    {
        _db = db;
        _schedulerFactory = schedulerFactory;
        _autoUpdateScheduler = autoUpdateScheduler;
        _systemUpdateScheduler = systemUpdateScheduler;
        _settings = settings;
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
        var systemUpdateExists = await scheduler.CheckExists(systemUpdateJobKey, ct).ConfigureAwait(false);
        if (systemUpdateExists)
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
        else
        {
            // Show as disabled if not scheduled
            results.Add(new MonitorJobSummaryDto
            {
                Id = Guid.Empty,
                Type = "system-update",
                Name = "System Updates",
                Schedule = "0 0 */6 * * ?", // Default schedule
                Enabled = false,
                LastRunAtUtc = null,
                NextRunAtUtc = null
            });
        }

        // Auto update job (global)
        var autoUpdateJobKey = new JobKey("global-auto-update", "autoupdate");
        var autoUpdateTriggerKey = new TriggerKey("global-auto-update-trigger", "autoupdate");
        var autoUpdateExists = await scheduler.CheckExists(autoUpdateJobKey, ct).ConfigureAwait(false);
        if (autoUpdateExists)
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
        else
        {
            // Show as disabled if not scheduled
            results.Add(new MonitorJobSummaryDto
            {
                Id = Guid.Empty,
                Type = "agent-update",
                Name = "Agent Updates",
                Schedule = "0 */15 * * * ?", // Default schedule
                Enabled = false,
                LastRunAtUtc = null,
                NextRunAtUtc = null
            });
        }

        return Ok(results.OrderBy(r => r.Type).ThenBy(r => r.Name).ToList());
    }

    /// <summary>
    /// Updates the schedule for a global monitoring job (agent-update or system-update).
    /// </summary>
    [HttpPut("global/{jobType}/schedule")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.DevicesManage)]
    public async Task<ActionResult> UpdateGlobalJobSchedule(
        string jobType, 
        [FromBody] UpdateJobScheduleRequest request,
        CancellationToken ct)
    {
        // Validate cron expression
        if (string.IsNullOrWhiteSpace(request.CronExpression))
        {
            return BadRequest(new { error = "Cron expression is required" });
        }

        if (!CronExpression.IsValidExpression(request.CronExpression))
        {
            return BadRequest(new { error = "Invalid cron expression" });
        }

        switch (jobType.ToLowerInvariant())
        {
            case "agent-update":
                await _settings.SetValueAsync(
                    SettingKeys.AutoUpdate.JobSchedule, 
                    request.CronExpression, 
                    "AutoUpdate", 
                    "Cron expression for agent update job");
                await _autoUpdateScheduler.ScheduleGlobalAutoUpdateJobAsync(request.CronExpression, ct);
                return Ok(new { message = "Agent update job schedule updated", schedule = request.CronExpression });

            case "system-update":
                await _settings.SetValueAsync(
                    SettingKeys.SystemUpdate.JobSchedule, 
                    request.CronExpression, 
                    "SystemUpdate", 
                    "Cron expression for system update job");
                await _systemUpdateScheduler.ScheduleGlobalSystemUpdateJobAsync(request.CronExpression, ct);
                return Ok(new { message = "System update job schedule updated", schedule = request.CronExpression });

            default:
                return BadRequest(new { error = $"Unknown job type: {jobType}. Valid types: agent-update, system-update" });
        }
    }

    /// <summary>
    /// Enables or disables a global monitoring job.
    /// </summary>
    [HttpPut("global/{jobType}/enabled")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.DevicesManage)]
    public async Task<ActionResult> UpdateGlobalJobEnabled(
        string jobType,
        [FromBody] UpdateJobEnabledRequest request,
        CancellationToken ct)
    {
        switch (jobType.ToLowerInvariant())
        {
            case "agent-update":
                await _settings.SetValueAsync(
                    SettingKeys.AutoUpdate.JobEnabled, 
                    request.Enabled.ToString().ToLowerInvariant(), 
                    "AutoUpdate", 
                    "Whether agent update job is enabled");
                
                if (request.Enabled)
                {
                    var customSchedule = await _settings.GetValueAsync(SettingKeys.AutoUpdate.JobSchedule);
                    await _autoUpdateScheduler.ScheduleGlobalAutoUpdateJobAsync(customSchedule, ct);
                    return Ok(new { message = "Agent update job enabled" });
                }
                else
                {
                    await _autoUpdateScheduler.RemoveGlobalAutoUpdateJobAsync(ct);
                    return Ok(new { message = "Agent update job disabled" });
                }

            case "system-update":
                await _settings.SetValueAsync(
                    SettingKeys.SystemUpdate.JobEnabled, 
                    request.Enabled.ToString().ToLowerInvariant(), 
                    "SystemUpdate", 
                    "Whether system update job is enabled");
                
                if (request.Enabled)
                {
                    var customSchedule = await _settings.GetValueAsync(SettingKeys.SystemUpdate.JobSchedule);
                    await _systemUpdateScheduler.ScheduleGlobalSystemUpdateJobAsync(customSchedule, ct);
                    return Ok(new { message = "System update job enabled" });
                }
                else
                {
                    await _systemUpdateScheduler.RemoveGlobalSystemUpdateJobAsync(ct);
                    return Ok(new { message = "System update job disabled" });
                }

            default:
                return BadRequest(new { error = $"Unknown job type: {jobType}. Valid types: agent-update, system-update" });
        }
    }

    /// <summary>
    /// Manually triggers a global monitoring job.
    /// </summary>
    [HttpPost("global/{jobType}/trigger")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.DevicesManage)]
    public async Task<ActionResult> TriggerGlobalJob(string jobType, CancellationToken ct)
    {
        switch (jobType.ToLowerInvariant())
        {
            case "agent-update":
                await _autoUpdateScheduler.TriggerAutoUpdateJobAsync(ct);
                return Accepted(new { message = "Agent update job triggered" });

            case "system-update":
                await _systemUpdateScheduler.TriggerSystemUpdateJobAsync(ct);
                return Accepted(new { message = "System update job triggered" });

            default:
                return BadRequest(new { error = $"Unknown job type: {jobType}. Valid types: agent-update, system-update" });
        }
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

public sealed record UpdateJobScheduleRequest
{
    public string CronExpression { get; init; } = string.Empty;
}

public sealed record UpdateJobEnabledRequest
{
    public bool Enabled { get; init; }
}
