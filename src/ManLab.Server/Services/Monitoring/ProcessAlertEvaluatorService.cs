using ManLab.Server.Hubs;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;
using NATS.Client.Core;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// Background service that consumes process alert evaluation requests from NATS.
/// Uses global serializer registry for optimal performance.
/// </summary>
public sealed class ProcessAlertEvaluatorService(
    INatsConnection nats,
    ProcessAlertingService alertingService,
    IHubContext<AgentHub> hubContext,
    ILogger<ProcessAlertEvaluatorService> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        logger.LogInformation("Process alert evaluator service started (NATS)");

        try
        {
            await foreach (var msg in nats.SubscribeAsync<ProcessAlertContext>(ProcessAlertQueue.Subject, queueGroup: "manlab.server.alerts", cancellationToken: stoppingToken))
            {
                if (msg.Data is { } context)
                {
                    try
                    {
                         await EvaluateAsync(context, stoppingToken);
                    }
                    catch (Exception ex)
                    {
                        logger.LogError(ex, "Error processing alert context for node {NodeId}", context.NodeId);
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Graceful shutdown
        }
        catch (Exception ex)
        {
            logger.LogCritical(ex, "Process alert evaluator service crashed");
        }
    }

    private async Task EvaluateAsync(ProcessAlertContext context, CancellationToken ct)
    {
        var alerts = alertingService.EvaluateAlerts(context.Processes, context.Config, context.NodeId);
        if (alerts.Count == 0)
        {
            return;
        }

        // Broadcast alerts to dashboard (best effort)
        try
        {
            await hubContext.Clients.Group(AgentHub.DashboardGroupName)
                .SendAsync("processalerts", context.NodeId, alerts, ct);
        }
        catch (Exception broadcastEx)
        {
            logger.LogWarning(broadcastEx, "Failed to broadcast process alerts for node {NodeId}", context.NodeId);
        }

        // Send notifications (e.g. Discord, persistent logs)
        await alertingService.SendAlertNotificationsAsync(alerts, ct);
    }
}
