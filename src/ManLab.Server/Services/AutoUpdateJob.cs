using Quartz;

namespace ManLab.Server.Services;

/// <summary>
/// Quartz job that periodically checks for and applies automatic agent updates.
/// </summary>
[DisallowConcurrentExecution]
public sealed class AutoUpdateJob : IJob
{
    private readonly AutoUpdateService _autoUpdateService;
    private readonly ILogger<AutoUpdateJob> _logger;

    public AutoUpdateJob(
        AutoUpdateService autoUpdateService,
        ILogger<AutoUpdateJob> logger)
    {
        _autoUpdateService = autoUpdateService;
        _logger = logger;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        _logger.LogDebug("Auto-update job started at {Time}", DateTime.UtcNow);

        try
        {
            var force = context.MergedJobDataMap.GetBoolean("force");
            await _autoUpdateService.CheckAndApplyUpdatesAsync(force, context.CancellationToken);
            _logger.LogDebug("Auto-update job completed at {Time}", DateTime.UtcNow);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Auto-update job failed at {Time}", DateTime.UtcNow);
            throw;
        }
    }
}
