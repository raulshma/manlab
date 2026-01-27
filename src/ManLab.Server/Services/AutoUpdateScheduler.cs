using Quartz;

namespace ManLab.Server.Services;

/// <summary>
/// Scheduler for automatic agent update jobs.
/// </summary>
public sealed class AutoUpdateScheduler
{
    public const string JobGroup = "autoupdate";
    public const string JobKey = "global-auto-update";
    public const string TriggerKey = "global-auto-update-trigger";

    private const string DefaultCronExpression = "0 */15 * * * ?"; // Every 15 minutes

    private readonly ISchedulerFactory _schedulerFactory;
    private readonly ILogger<AutoUpdateScheduler> _logger;

    public AutoUpdateScheduler(
        ISchedulerFactory schedulerFactory,
        ILogger<AutoUpdateScheduler> logger)
    {
        _schedulerFactory = schedulerFactory;
        _logger = logger;
    }

    /// <summary>
    /// Schedules the global auto-update job that checks all nodes for updates.
    /// </summary>
    public async Task ScheduleGlobalAutoUpdateJobAsync(CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = new JobKey(JobKey, JobGroup);
        var triggerKey = new TriggerKey(TriggerKey, JobGroup);

        var job = JobBuilder.Create<AutoUpdateJob>()
            .WithIdentity(jobKey)
            .WithDescription("Periodically checks all nodes for available agent updates")
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity(triggerKey)
            .WithCronSchedule(DefaultCronExpression, cron => cron
                .WithMisfireHandlingInstructionDoNothing())
            .WithDescription("Runs every 15 minutes")
            .Build();

        if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            _logger.LogInformation("Auto-update job already exists, rescheduling");
            await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
        }

        await scheduler.ScheduleJob(job, trigger, ct).ConfigureAwait(false);
        _logger.LogInformation("Scheduled global auto-update job with cron: {Cron}", DefaultCronExpression);
    }

    /// <summary>
    /// Removes the global auto-update job.
    /// </summary>
    public async Task RemoveGlobalAutoUpdateJobAsync(CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = new JobKey(JobKey, JobGroup);

        if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
            _logger.LogInformation("Removed global auto-update job");
        }
    }

    /// <summary>
    /// Manually triggers the auto-update job.
    /// </summary>
    public async Task TriggerAutoUpdateJobAsync(CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = new JobKey(JobKey, JobGroup);

        if (!await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            _logger.LogWarning("Auto-update job does not exist, scheduling it first");
            await ScheduleGlobalAutoUpdateJobAsync(ct).ConfigureAwait(false);
        }

        await scheduler.TriggerJob(jobKey, ct).ConfigureAwait(false);
        _logger.LogInformation("Manually triggered auto-update job");
    }
}
