using ManLab.Server.Data.Entities.Enhancements;
using Quartz;

namespace ManLab.Server.Services.Monitoring;

public sealed class MonitorJobScheduler
{
    public const string JobGroup = "monitoring";

    private readonly ISchedulerFactory _schedulerFactory;

    public MonitorJobScheduler(ISchedulerFactory schedulerFactory)
    {
        _schedulerFactory = schedulerFactory;
    }

    public static JobKey GetHttpJobKey(Guid id) => new($"http-monitor-{id}", JobGroup);
    public static TriggerKey GetHttpTriggerKey(Guid id) => new($"http-monitor-trigger-{id}", JobGroup);
    public static JobKey GetTrafficJobKey(Guid id) => new($"traffic-monitor-{id}", JobGroup);
    public static TriggerKey GetTrafficTriggerKey(Guid id) => new($"traffic-monitor-trigger-{id}", JobGroup);

    public async Task ApplyHttpMonitorScheduleAsync(HttpMonitorConfig config, CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = GetHttpJobKey(config.Id);
        var triggerKey = GetHttpTriggerKey(config.Id);

        if (!config.Enabled)
        {
            if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
            {
                await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
            }
            return;
        }

        var job = JobBuilder.Create<HttpMonitorJob>()
            .WithIdentity(jobKey)
            .UsingJobData("monitorId", config.Id.ToString())
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity(triggerKey)
            .WithCronSchedule(config.Cron, cron => cron.WithMisfireHandlingInstructionDoNothing())
            .Build();

        if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
        }

        await scheduler.ScheduleJob(job, trigger, ct).ConfigureAwait(false);
    }

    public async Task ApplyTrafficMonitorScheduleAsync(TrafficMonitorConfig config, CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        var jobKey = GetTrafficJobKey(config.Id);
        var triggerKey = GetTrafficTriggerKey(config.Id);

        if (!config.Enabled)
        {
            if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
            {
                await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
            }
            return;
        }

        var job = JobBuilder.Create<TrafficMonitorJob>()
            .WithIdentity(jobKey)
            .UsingJobData("monitorId", config.Id.ToString())
            .Build();

        var trigger = TriggerBuilder.Create()
            .WithIdentity(triggerKey)
            .WithCronSchedule(config.Cron, cron => cron.WithMisfireHandlingInstructionDoNothing())
            .Build();

        if (await scheduler.CheckExists(jobKey, ct).ConfigureAwait(false))
        {
            await scheduler.DeleteJob(jobKey, ct).ConfigureAwait(false);
        }

        await scheduler.ScheduleJob(job, trigger, ct).ConfigureAwait(false);
    }

    public async Task TriggerHttpMonitorAsync(Guid id, CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        await scheduler.TriggerJob(GetHttpJobKey(id), ct).ConfigureAwait(false);
    }

    public async Task TriggerTrafficMonitorAsync(Guid id, CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        await scheduler.TriggerJob(GetTrafficJobKey(id), ct).ConfigureAwait(false);
    }

    public async Task RemoveHttpMonitorAsync(Guid id, CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        await scheduler.DeleteJob(GetHttpJobKey(id), ct).ConfigureAwait(false);
    }

    public async Task RemoveTrafficMonitorAsync(Guid id, CancellationToken ct = default)
    {
        var scheduler = await _schedulerFactory.GetScheduler(ct).ConfigureAwait(false);
        await scheduler.DeleteJob(GetTrafficJobKey(id), ct).ConfigureAwait(false);
    }
}
