using ManLab.Server.Constants;
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
    private readonly IServiceProvider _serviceProvider;
    private readonly ISettingsService _settingsService;

    public SystemUpdateScheduler(
        ISchedulerFactory schedulerFactory,
        ILogger<SystemUpdateScheduler> logger,
        IServiceProvider serviceProvider,
        ISettingsService settingsService)
    {
        _schedulerFactory = schedulerFactory;
        _logger = logger;
        _serviceProvider = serviceProvider;
        _settingsService = settingsService;
    }

    /// <summary>
    /// Schedules the global system update job that checks all nodes for updates.
    /// </summary>
    /// <param name="cronExpression">Optional custom cron expression. If null, uses default.</param>
    /// <param name="ct">Cancellation token.</param>
    public async Task ScheduleGlobalSystemUpdateJobAsync(string? cronExpression = null, CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = new JobKey(JobKey, JobGroup);
        var triggerKey = new TriggerKey(TriggerKey, JobGroup);

        var effectiveCron = cronExpression ?? DefaultCronExpression;

        // Get job-level auto-approve setting
        var autoApprove = await _settingsService.GetValueAsync(SettingKeys.SystemUpdate.JobAutoApprove, false);

        var job = JobBuilder.Create<SystemUpdateJob>()
            .WithIdentity(jobKey)
            .WithDescription("Periodically checks all nodes for available system updates")
            .UsingJobData("autoApprove", autoApprove)
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity(triggerKey)
            .WithCronSchedule(effectiveCron, cron => cron
                .WithMisfireHandlingInstructionDoNothing())
            .WithDescription($"Cron: {effectiveCron}")
            .Build();

        if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            _logger.LogInformation("System update job already exists, rescheduling");
            await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
        }

        await scheduler.ScheduleJob(job, trigger, ct).ConfigureAwait(false);
        _logger.LogInformation("Scheduled global system update job with cron: {Cron}", effectiveCron);
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
    /// Manually triggers the system update job synchronously.
    /// </summary>
    public async Task TriggerSystemUpdateJobAsync(CancellationToken ct = default)
    {
        await using var scope = _serviceProvider.CreateAsyncScope();
        var systemUpdateService = scope.ServiceProvider.GetRequiredService<SystemUpdateService>();

        _logger.LogInformation("Manually triggering system update job (synchronous)");

        try
        {
            // Get job-level auto-approve setting
            var autoApprove = await _settingsService.GetValueAsync(SettingKeys.SystemUpdate.JobAutoApprove, false);

            // Execute the job logic directly, skipping Quartz scheduler
            // This ensures immediate execution and proper error handling
            await systemUpdateService.CheckAndCreatePendingUpdatesAsync(force: true, autoApprove, ct);
            _logger.LogInformation("System update job execution completed");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "System update job execution failed");
            throw;
        }
    }
}
