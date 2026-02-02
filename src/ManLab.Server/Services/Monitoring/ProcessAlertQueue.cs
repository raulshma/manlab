using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// NATS-backed queue for process alert evaluations.
/// </summary>
public sealed class ProcessAlertQueue(INatsConnection nats, ILogger<ProcessAlertQueue> logger)
{
    public const string Subject = "process.alerts";

    public async ValueTask<bool> TryEnqueueAsync(ProcessAlertContext context, CancellationToken cancellationToken = default)
    {
        try
        {
            await nats.PublishAsync(Subject, context, cancellationToken: cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to publish process alert to NATS for node {NodeId}", context.NodeId);
            return false;
        }
    }
}
