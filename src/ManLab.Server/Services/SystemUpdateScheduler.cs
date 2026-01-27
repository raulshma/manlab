using Quartz;

namespace ManLab.Server.Services;

/// <summary>
/// Scheduler for system update jobs.
/// </summary>
public sealed class SystemUpdateScheduler
{
    public const string JobGroup = "system-update";
    public const string JobKey = "global-system-update";
    public const string TriggerKey = "global-system-update-trigger";

    private const string DefaultCronExpression = "0 0 */6 * * ?"; // Every 6 hours

    private readonly ISchedulerFactory _schedulerFactory;
    private readonly ILogger<SystemUpdateScheduler> _logger;

    public SystemUpdateScheduler(
        ISchedulerFactory schedulerFactory,
        ILogger<SystemUpdateScheduler> logger)
    {
        _schedulerFactory = schedulerFactory;
        _logger = logger;
    }

    /// <summary>
    /// Schedules the global system update job that checks all nodes for updates.
    /// </summary>
    public async Task ScheduleGlobalSystemUpdateJobAsync(CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = new JobKey(JobKey, JobGroup);
        var triggerKey = new TriggerKey(TriggerKey, JobGroup);

        var job = JobBuilder.Create<SystemUpdateJob>()
            .WithIdentity(jobKey)
            .WithDescription("Periodically checks all nodes for available system updates")
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity(triggerKey)
            .WithCronSchedule(DefaultCronExpression, cron => cron
                .WithMisfireHandlingInstructionDoNothing())
            .WithDescription("Runs every 6 hours")
            .Build();

        if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            _logger.LogInformation("System update job already exists, rescheduling");
            await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
        }

        await scheduler.ScheduleJob(job, trigger, ct).ConfigureAwait(false);
        _logger.LogInformation("Scheduled global system update job with cron: {Cron}", DefaultCronExpression);
    }

    /// <summary>
    /// Removes the global system update job.
    /// </summary>
    public async Task RemoveGlobalSystemUpdateJobAsync(CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = new JobKey(JobKey, JobGroup);

        if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
            _logger.LogInformation("Removed global system update job");
        }
    }

    /// <summary>
    /// Manually triggers the system update job.
    /// </summary>
    public async Task TriggerSystemUpdateJobAsync(CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = new JobKey(JobKey, JobGroup);

        if (!await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            _logger.LogWarning("System update job does not exist, scheduling it first");
            await ScheduleGlobalSystemUpdateJobAsync(ct).ConfigureAwait(false);
        }

        await scheduler.TriggerJob(jobKey, ct).ConfigureAwait(false);
        _logger.LogInformation("Manually triggered system update job");
    }
}
