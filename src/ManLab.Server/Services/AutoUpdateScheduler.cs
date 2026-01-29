using ManLab.Server.Constants;
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
    private readonly IServiceProvider _serviceProvider;
    private readonly ISettingsService _settingsService;

    public AutoUpdateScheduler(
        ISchedulerFactory schedulerFactory,
        ILogger<AutoUpdateScheduler> logger,
        IServiceProvider serviceProvider,
        ISettingsService settingsService)
    {
        _schedulerFactory = schedulerFactory;
        _logger = logger;
        _serviceProvider = serviceProvider;
        _settingsService = settingsService;
    }

    /// <summary>
    /// Schedules the global auto-update job that checks all nodes for updates.
    /// </summary>
    /// <param name="cronExpression">Optional custom cron expression. If null, uses default.</param>
    /// <param name="ct">Cancellation token.</param>
    public async Task ScheduleGlobalAutoUpdateJobAsync(string? cronExpression = null, CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = new JobKey(JobKey, JobGroup);
        var triggerKey = new TriggerKey(TriggerKey, JobGroup);

        var effectiveCron = cronExpression ?? DefaultCronExpression;

        // Get job-level approval mode setting
        var approvalMode = await _settingsService.GetValueAsync(SettingKeys.AutoUpdate.JobApprovalMode, "manual");
        var sendDiscord = await _settingsService.GetValueAsync(SettingKeys.AutoUpdate.JobSendDiscordNotification, false);

        var job = JobBuilder.Create<AutoUpdateJob>()
            .WithIdentity(jobKey)
            .WithDescription("Periodically checks all nodes for available agent updates")
            .UsingJobData("approvalMode", approvalMode)
            .UsingJobData("sendDiscordNotification", sendDiscord)
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity(triggerKey)
            .WithCronSchedule(effectiveCron, cron => cron
                .WithMisfireHandlingInstructionDoNothing())
            .WithDescription($"Cron: {effectiveCron}")
            .Build();

        if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            _logger.LogInformation("Auto-update job already exists, rescheduling");
            await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
        }

        await scheduler.ScheduleJob(job, trigger, ct).ConfigureAwait(false);
        _logger.LogInformation("Scheduled global auto-update job with cron: {Cron}", effectiveCron);
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
    /// Manually triggers the auto-update job synchronously.
    /// </summary>
    public async Task TriggerAutoUpdateJobAsync(CancellationToken ct = default)
    {
        await using var scope = _serviceProvider.CreateAsyncScope();
        var autoUpdateService = scope.ServiceProvider.GetRequiredService<AutoUpdateService>();

        _logger.LogInformation("Manually triggering auto-update job (synchronous)");

        try
        {
            // Get job-level approval mode setting
            var approvalMode = await _settingsService.GetValueAsync(SettingKeys.AutoUpdate.JobApprovalMode, "manual");
            var sendDiscord = await _settingsService.GetValueAsync(SettingKeys.AutoUpdate.JobSendDiscordNotification, false);

            // Execute the job logic directly, skipping Quartz scheduler
            // This ensures immediate execution and proper error handling
            await autoUpdateService.CheckAndApplyUpdatesAsync(force: true, approvalMode, sendDiscord, ct);
            _logger.LogInformation("Auto-update job execution completed");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Auto-update job execution failed");
            throw;
        }
    }
}
