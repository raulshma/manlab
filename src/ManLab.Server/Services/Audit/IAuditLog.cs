using ManLab.Server.Data.Entities;

namespace ManLab.Server.Services.Audit;

/// <summary>
/// Best-effort, non-blocking audit/activity logging.
///
/// This API must never throw to callers; failures are logged and events may be dropped.
/// </summary>
public interface IAuditLog
{
    bool TryEnqueue(AuditEvent evt);
}
