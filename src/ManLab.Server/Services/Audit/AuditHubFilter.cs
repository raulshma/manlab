using ManLab.Server.Services.Audit;
using Microsoft.AspNetCore.SignalR;

namespace ManLab.Server.Services.Audit;

/// <summary>
/// Captures high-signal SignalR failures (exceptions) as audit events.
///
/// We intentionally do NOT log successful invocations here to avoid hot-path noise (heartbeats).
/// High-value success events should be recorded explicitly at call sites.
/// </summary>
public sealed class AuditHubFilter : IHubFilter
{
    private static readonly HashSet<string> IgnoredMethods = new(StringComparer.Ordinal)
    {
        // Extremely frequent; do not audit by default.
        "SendHeartbeat",
        "SendServiceStatusSnapshots",
        "SendSmartDriveSnapshots",
        "SendGpuSnapshots",
        "SendUpsSnapshots"
    };

    private readonly IAuditLog _audit;

    public AuditHubFilter(IAuditLog audit)
    {
        _audit = audit;
    }

    public async ValueTask<object?> InvokeMethodAsync(
        HubInvocationContext invocationContext,
        Func<HubInvocationContext, ValueTask<object?>> next)
    {
        var method = invocationContext.HubMethodName;

        try
        {
            return await next(invocationContext).ConfigureAwait(false);
        }
        catch (Exception ex)
        {
            if (!IgnoredMethods.Contains(method))
            {
                var evt = AuditEventFactory.CreateSignalR(
                    kind: "audit",
                    eventName: "signalr.invocation.failed",
                    context: invocationContext.Context,
                    hub: invocationContext.Hub?.GetType().Name,
                    hubMethod: method,
                    success: false,
                    category: "signalr",
                    message: "Hub invocation failed",
                    error: ex.GetType().Name);

                _audit.TryEnqueue(evt);
            }

            throw;
        }
    }
}
