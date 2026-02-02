using ManLab.Server.Data.Entities;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;

namespace ManLab.Server.Services.Audit;

/// <summary>
/// NATS-backed queue for audit log events.
/// </summary>
public sealed class AuditLogQueue(INatsConnection nats, ILogger<AuditLogQueue> logger)
{
    public const string Subject = "manlab.audit.events";

    public async ValueTask<bool> TryEnqueueAsync(AuditEvent evt, CancellationToken cancellationToken = default)
    {
        try
        {
            await nats.PublishAsync(Subject, evt, cancellationToken: cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to publish audit event to NATS");
            return false;
        }
    }
}

