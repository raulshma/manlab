using ManLab.Server.Data.Entities;
using ManLab.Server.Mappers;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;
using NATS.Client.Core;

namespace ManLab.Server.Services.Audit;

/// <summary>
/// NATS-backed queue for audit log events.
/// Uses AuditEventDto with source-generated JSON serialization and Mapperly for zero-overhead mapping.
/// </summary>
public sealed class AuditLogQueue(INatsConnection nats, ILogger<AuditLogQueue> logger)
{
    public const string Subject = "manlab.audit.events";

    public async ValueTask<bool> TryEnqueueAsync(AuditEvent evt, CancellationToken cancellationToken = default)
    {
        try
        {
            // Use Mapperly for zero-runtime-overhead mapping to DTO
            var dto = evt.ToDto();
            await nats.PublishAsync(Subject, dto, cancellationToken: cancellationToken).ConfigureAwait(false);
            return true;
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed to publish audit event to NATS");
            return false;
        }
    }
}
