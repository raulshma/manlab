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
    private readonly ILogger<MonitorJobsController> _logger;

    public MonitorJobsController(
        DataContext db,
        ISchedulerFactory schedulerFactory,
        AutoUpdateScheduler autoUpdateScheduler,
        SystemUpdateScheduler systemUpdateScheduler,
        ISettingsService settings,
        ILogger<MonitorJobsController> logger)
    {
        _db = db;
        _schedulerFactory = schedulerFactory;
        _autoUpdateScheduler = autoUpdateScheduler;
        _systemUpdateScheduler = systemUpdateScheduler;
        _settings = settings;
        _logger = logger;
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
                Id = Guid.Parse("55555555-5555-5555-5555-555555555555"), // Fixed ID for system update job
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
                Id = Guid.Parse("55555555-5555-5555-5555-555555555555"),
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
                Id = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"), // Fixed ID for agent update job
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
                Id = Guid.Parse("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa"),
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
    /// Updates the approval mode for a global update job (agent-update or system-update).
    /// </summary>
    [HttpPut("global/{jobType}/approval")]
    [Authorize(Policy = Permissions.PolicyPrefix + Permissions.DevicesManage)]
    public async Task<ActionResult> UpdateGlobalJobApproval(
        string jobType,
        [FromBody] UpdateJobApprovalRequest request,
        CancellationToken ct)
    {
        switch (jobType.ToLowerInvariant())
        {
            case "agent-update":
                if (request.ApprovalMode != "automatic" && request.ApprovalMode != "manual")
                {
                    return BadRequest(new { error = "Approval mode must be 'automatic' or 'manual'" });
                }

                await _settings.SetValueAsync(
                    SettingKeys.AutoUpdate.JobApprovalMode,
                    request.ApprovalMode,
                    "AutoUpdate",
                    "Job-level approval mode for agent updates");

                // Reschedule job to apply new setting
                if (await _settings.GetValueAsync(SettingKeys.AutoUpdate.JobEnabled, true))
                {
                    var customSchedule = await _settings.GetValueAsync(SettingKeys.AutoUpdate.JobSchedule);
                    await _autoUpdateScheduler.ScheduleGlobalAutoUpdateJobAsync(customSchedule, ct);
                }

                return Ok(new { message = $"Agent update job approval mode set to {request.ApprovalMode}", approvalMode = request.ApprovalMode });

            case "system-update":
                await _settings.SetValueAsync(
                    SettingKeys.SystemUpdate.JobAutoApprove,
                    request.AutoApprove.ToString().ToLowerInvariant(),
                    "SystemUpdate",
                    "Job-level auto-approve setting for system updates");

                // Reschedule job to apply new setting
                if (await _settings.GetValueAsync(SettingKeys.SystemUpdate.JobEnabled, true))
                {
                    var customSchedule = await _settings.GetValueAsync(SettingKeys.SystemUpdate.JobSchedule);
                    await _systemUpdateScheduler.ScheduleGlobalSystemUpdateJobAsync(customSchedule, ct);
                }

                return Ok(new { message = $"System update job auto-approve set to {request.AutoApprove}", autoApprove = request.AutoApprove });

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



    [HttpGet("{id}/history")]
    public async Task<ActionResult<List<JobExecutionHistoryDto>>> GetJobHistory(Guid id, [FromQuery] string type, CancellationToken ct)
    {
        _logger.LogInformation("GetJobHistory called: Id={Id}, Type={Type}", id, type);

        var history = new List<JobExecutionHistoryDto>();

        if (string.Equals(type, "http", StringComparison.OrdinalIgnoreCase))
        {
             var checks = await _db.HttpMonitorChecks
                .AsNoTracking()
                .Where(c => c.MonitorId == id)
                .OrderByDescending(c => c.TimestampUtc)
                .Take(20)
                .ToListAsync(ct);
             
             history = checks.Select(c => new JobExecutionHistoryDto
             {
                 TimestampUtc = c.TimestampUtc,
                 Success = c.Success,
                 DurationMs = c.ResponseTimeMs,
                 Message = c.ErrorMessage ?? (c.Success ? $"Status: {c.StatusCode}" : "Failed"),
                 DetailsJson = System.Text.Json.JsonSerializer.Serialize(new { c.StatusCode, c.KeywordMatched, c.SslDaysRemaining })
             }).ToList();
        }
        else if (string.Equals(type, "network-tool", StringComparison.OrdinalIgnoreCase))
        {
            var config = await _db.ScheduledNetworkToolConfigs.FindAsync(new object[] { id }, ct);
            if (config != null)
            {
                var target = config.Target ?? config.ToolType;
                var toolType = $"scheduled-{config.ToolType}";
                
                var entries = await _db.NetworkToolHistory
                   .AsNoTracking()
                   .Where(h => h.ToolType == toolType && h.Target == target)
                   .OrderByDescending(h => h.TimestampUtc)
                   .Take(20)
                   .ToListAsync(ct);

                history = entries.Select(h => new JobExecutionHistoryDto
                {
                    TimestampUtc = h.TimestampUtc,
                    Success = h.Success,
                    DurationMs = h.DurationMs,
                    Message = h.ErrorMessage ?? (h.Success ? "Completed" : "Failed"),
                    DetailsJson = h.ResultJson
                }).ToList();
            }
        }
        else if (string.Equals(type, "traffic", StringComparison.OrdinalIgnoreCase))
        {
             var config = await _db.TrafficMonitorConfigs.FindAsync(new object[] { id }, ct);
             if (config != null)
             {
                 var entries = await _db.NetworkToolHistory
                    .AsNoTracking()
                    .Where(h => h.ToolType == "monitor-traffic")
                    .OrderByDescending(h => h.TimestampUtc)
                    .Take(20)
                    .ToListAsync(ct);
                 
                 // If specific interface is configured, we could filter here, 
                 // but NetworkToolHistory stores it in InputJson. 
                 // For now, returning all traffic monitor history is acceptable provided there is usually only one.
                 
                 history = entries.Select(h => new JobExecutionHistoryDto
                 {
                     TimestampUtc = h.TimestampUtc,
                     Success = h.Success,
                     DurationMs = h.DurationMs,
                     Message = h.ErrorMessage,
                     DetailsJson = h.ResultJson
                 }).ToList();
             }
        }
        else if (string.Equals(type, "system-update", StringComparison.OrdinalIgnoreCase))
        {
            var updates = await _db.SystemUpdateHistories
                .AsNoTracking()
                .OrderByDescending(x => x.StartedAt)
                .Take(20)
                .ToListAsync(ct);

            history = updates.Select(x => new JobExecutionHistoryDto
            {
                TimestampUtc = x.StartedAt,
                Success = x.Status == "Completed" || x.Status == "Succeeded",
                DurationMs = x.CompletedAt.HasValue ? (int)(x.CompletedAt.Value - x.StartedAt).TotalMilliseconds : 0,
                Message = $"{x.Status} (Node: {x.NodeId})",
                DetailsJson = System.Text.Json.JsonSerializer.Serialize(new { x.NodeId, PackageCount = GetPackageCount(x.PackagesJson) })
            }).ToList();
        }
        else if (string.Equals(type, "agent-update", StringComparison.OrdinalIgnoreCase))
        {
            // Agent updates are tracked in audit logs since they don't have a dedicated history table besides node settings
            var audits = await _db.AuditEvents
                .AsNoTracking()
                .Where(x => x.Category == "auto-update")
                .OrderByDescending(x => x.TimestampUtc)
                .Take(20)
                .ToListAsync(ct);

            _logger.LogInformation("Found {Count} audit entries for agent-update", audits.Count);

            history = audits.Select(x => new JobExecutionHistoryDto
            {
                TimestampUtc = x.TimestampUtc,
                Success = x.Success ?? false,
                DurationMs = 0, // Audit logs don't track duration
                Message = x.Message,
                DetailsJson = System.Text.Json.JsonSerializer.Serialize(new { x.NodeId, x.EventName })
            }).ToList();
        }

        _logger.LogInformation("Returning {Count} history entries for type {Type}", history.Count, type);
        return Ok(history);
    }

    private int GetPackageCount(string? json)
    {
        if (string.IsNullOrEmpty(json)) return 0;
        try 
        {
            using var doc = System.Text.Json.JsonDocument.Parse(json);
            return doc.RootElement.ValueKind == System.Text.Json.JsonValueKind.Array ? doc.RootElement.GetArrayLength() : 0;
        }
        catch { return 0; }
    }

    [HttpGet("history")]
    public async Task<ActionResult<List<GlobalJobHistoryDto>>> GetGlobalHistory([FromQuery] int count = 50, CancellationToken ct = default)
    {
        var countPerType = count;

        var httpHistory = await _db.HttpMonitorChecks
            .AsNoTracking()
            .OrderByDescending(x => x.TimestampUtc)
            .Take(countPerType)
            .Select(x => new GlobalJobHistoryDto
            {
                Id = x.Id.ToString(),
                JobId = x.MonitorId.ToString(),
                JobName = x.Monitor != null ? x.Monitor.Name : "Unknown HTTP Monitor",
                JobType = "http",
                TimestampUtc = x.TimestampUtc,
                Success = x.Success,
                DurationMs = x.ResponseTimeMs,
                Message = x.ErrorMessage ?? (x.Success ? $"Status: {x.StatusCode}" : "Failed"),
                DetailsJson = null
            })
            .ToListAsync(ct);

        var netHistory = await _db.NetworkToolHistory
            .AsNoTracking()
            .OrderByDescending(x => x.TimestampUtc)
            .Take(countPerType)
            .Select(x => new GlobalJobHistoryDto
            {
                Id = x.Id.ToString(),
                JobId = null,
                JobName = x.ToolType + (string.IsNullOrEmpty(x.Target) ? "" : $" ({x.Target})"),
                JobType = x.ToolType == "Traffic" ? "traffic" : "network-tool",
                TimestampUtc = x.TimestampUtc,
                Success = x.Success,
                DurationMs = x.DurationMs,
                Message = x.ErrorMessage ?? (x.Success ? "Success" : "Failed"),
                DetailsJson = null
            })
            .ToListAsync(ct);

        var sysUpdates = await _db.SystemUpdateHistories
            .AsNoTracking()
            .OrderByDescending(x => x.StartedAt)
            .Take(countPerType)
            .Select(x => new GlobalJobHistoryDto
            {
                Id = x.Id.ToString(),
                JobId = x.Id.ToString(),
                JobName = "System Update",
                JobType = "system-update",
                TimestampUtc = x.StartedAt,
                Success = x.Status == "Completed" || x.Status == "Succeeded",
                DurationMs = x.CompletedAt.HasValue ? (int)(x.CompletedAt.Value - x.StartedAt).TotalMilliseconds : 0,
                Message = x.Status,
                DetailsJson = null
            })
            .ToListAsync(ct);

        // Agent update history from audit logs
        var agentUpdateAudits = await _db.AuditEvents
            .AsNoTracking()
            .Where(x => x.Category == "auto-update")
            .OrderByDescending(x => x.TimestampUtc)
            .Take(countPerType)
            .Select(x => new GlobalJobHistoryDto
            {
                Id = x.Id.ToString(),
                JobId = x.NodeId == Guid.Empty ? null : x.NodeId.ToString(),
                JobName = "Agent Updates",
                JobType = "agent-update",
                TimestampUtc = x.TimestampUtc,
                Success = x.Success ?? false,
                DurationMs = 0,
                Message = x.Message,
                DetailsJson = null
            })
            .ToListAsync(ct);

        var allHistory = httpHistory
            .Concat(netHistory)
            .Concat(sysUpdates)
            .Concat(agentUpdateAudits)  // ← Added agent updates!
            .OrderByDescending(x => x.TimestampUtc)
            .Take(count)
            .ToList();

        return Ok(allHistory);
    }

    [HttpGet("running")]
    public async Task<ActionResult<List<RunningJobDto>>> GetRunningJobs(CancellationToken ct)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct);
        var executingJobs = await scheduler.GetCurrentlyExecutingJobs(ct);
        
        var running = executingJobs.Select(context => new RunningJobDto
        {
            JobGroup = context.JobDetail.Key.Group,
            JobName = context.JobDetail.Key.Name,
            TriggerGroup = context.Trigger.Key.Group,
            TriggerName = context.Trigger.Key.Name,
            FireTimeUtc = context.FireTimeUtc.UtcDateTime,
            RunTimeMs = (int)(DateTime.UtcNow - context.FireTimeUtc.UtcDateTime).TotalMilliseconds,
        }).ToList();

        return Ok(running);
    }

    /// <summary>
    /// Diagnostic endpoint to check if audit logs are being created.
    /// </summary>
    [HttpGet("audit-health")]
    public async Task<ActionResult> GetAuditHealth(CancellationToken ct)
    {
        var recentAudits = await _db.AuditEvents
            .AsNoTracking()
            .OrderByDescending(x => x.TimestampUtc)
            .Take(10)
            .Select(x => new
            {
                x.Id,
                x.TimestampUtc,
                x.Category,
                x.EventName,
                x.Message,
                x.Success
            })
            .ToListAsync(ct);

        var autoUpdateAudits = await _db.AuditEvents
            .AsNoTracking()
            .Where(x => x.Category == "auto-update")
            .OrderByDescending(x => x.TimestampUtc)
            .Take(5)
            .Select(x => new
            {
                x.Id,
                x.TimestampUtc,
                x.EventName,
                x.Message
            })
            .ToListAsync(ct);

        var systemUpdateAudits = await _db.AuditEvents
            .AsNoTracking()
            .Where(x => x.Category == "system-update")
            .OrderByDescending(x => x.TimestampUtc)
            .Take(5)
            .Select(x => new
            {
                x.Id,
                x.TimestampUtc,
                x.EventName,
                x.Message
            })
            .ToListAsync(ct);

        return Ok(new
        {
            recentAuditCount = recentAudits.Count,
            latestAudit = recentAudits.FirstOrDefault(),
            autoUpdateAuditCount = autoUpdateAudits.Count,
            latestAutoUpdateAudit = autoUpdateAudits.FirstOrDefault(),
            systemUpdateAuditCount = systemUpdateAudits.Count,
            latestSystemUpdateAudit = systemUpdateAudits.FirstOrDefault(),
            categories = recentAudits.Select(x => x.Category).Distinct().ToList()
        });
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

public sealed record UpdateJobApprovalRequest
{
    public string ApprovalMode { get; init; } = "manual"; // For agent-update: "automatic" or "manual"
    public bool AutoApprove { get; init; } // For system-update: true or false
}

public sealed record JobExecutionHistoryDto
{
    public DateTime TimestampUtc { get; init; }
    public bool Success { get; init; }
    public int DurationMs { get; init; }
    public string? Message { get; init; }
    public string? DetailsJson { get; init; }
}

public sealed record GlobalJobHistoryDto
{
    public required string Id { get; init; }
    public string? JobId { get; init; }
    public required string JobName { get; init; }
    public required string JobType { get; init; }
    public DateTime TimestampUtc { get; init; }
    public bool Success { get; init; }
    public int DurationMs { get; init; }
    public string? Message { get; init; }
    public string? DetailsJson { get; init; }
}

public sealed record RunningJobDto
{
    public required string JobGroup { get; init; }
    public required string JobName { get; init; }
    public required string TriggerGroup { get; init; }
    public required string TriggerName { get; init; }
    public DateTime FireTimeUtc { get; init; }
    public int RunTimeMs { get; init; }
    public int? Progress { get; init; }
}

