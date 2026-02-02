using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;
using System.Threading.Tasks;

namespace ManLab.Server.Services.Monitoring;



/// <summary>
/// NATS-backed queue for process alert evaluations.
/// </summary>
public sealed class ProcessAlertQueue(INatsConnection nats, ILogger<ProcessAlertQueue> logger)
{
    public const string Subject = "process.alerts";

    public void TryEnqueue(ProcessAlertContext context)
    {
        // Fire-and-forget publish to NATS
        // We use value task to avoid allocation if possible, but here we just launch it
        // In a high-throughput scenario, we might want to batch or check connection status
        _ = Task.Run(async () =>
        {
            try 
            {
                await nats.PublishAsync(Subject, context);
            }
            catch (Exception ex)
            {
                logger.LogWarning(ex, "Failed to publish process alert to NATS for node {NodeId}", context.NodeId);
            }
        });
    }
}
