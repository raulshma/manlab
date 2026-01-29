using Quartz;

namespace ManLab.Server.Services;

/// <summary>
/// Quartz job that periodically checks for available system updates.
/// </summary>
[DisallowConcurrentExecution]
public sealed class SystemUpdateJob : IJob
{
    private readonly SystemUpdateService _systemUpdateService;
    private readonly ILogger<SystemUpdateJob> _logger;

    public SystemUpdateJob(
        SystemUpdateService systemUpdateService,
        ILogger<SystemUpdateJob> logger)
    {
        _systemUpdateService = systemUpdateService;
        _logger = logger;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        _logger.LogDebug("System update job started at {Time}", DateTime.UtcNow);

        try
        {
            // Default to false if "force" key is not present (scheduled job execution)
            var force = context.MergedJobDataMap.ContainsKey("force") &&
                       context.MergedJobDataMap.GetBoolean("force");

            // Get auto-approval setting from job data map (defaults to false)
            var autoApprove = !context.MergedJobDataMap.ContainsKey("autoApprove") ||
                             context.MergedJobDataMap.GetBoolean("autoApprove");

            var sendDiscord = context.MergedJobDataMap.ContainsKey("sendDiscordNotification") &&
                              context.MergedJobDataMap.GetBoolean("sendDiscordNotification");

            // Delegate to the service's method
            await _systemUpdateService.CheckAndCreatePendingUpdatesAsync(force, autoApprove, sendDiscord, context.CancellationToken);
            _logger.LogDebug("System update job completed at {Time}", DateTime.UtcNow);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "System update job failed at {Time}", DateTime.UtcNow);
            throw;
        }
    }
}
