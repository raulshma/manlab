using System.Diagnostics;
using ManLab.Server.Services.Audit;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Audit;

/// <summary>
/// Records a low-cardinality activity event for mutating HTTP requests.
///
/// This is intentionally generic and lightweight. High-value events should be recorded
/// explicitly at call sites with richer context.
/// </summary>
public sealed class AuditHttpMiddleware
{
    private static readonly HashSet<string> MutatingMethods = new(StringComparer.OrdinalIgnoreCase)
    {
        "POST",
        "PUT",
        "PATCH",
        "DELETE"
    };

    private readonly RequestDelegate _next;

    public AuditHttpMiddleware(RequestDelegate next)
    {
        _next = next;
    }

    public async Task InvokeAsync(HttpContext context, IAuditLog audit, IOptionsMonitor<AuditOptions> options)
    {
        if (!options.CurrentValue.Enabled)
        {
            await _next(context);
            return;
        }

        var method = context.Request.Method;
        if (!MutatingMethods.Contains(method))
        {
            await _next(context);
            return;
        }

        // Skip swagger / health / hub endpoints.
        var path = context.Request.Path;
        if (path.StartsWithSegments("/health") || path.StartsWithSegments("/alive") || path.StartsWithSegments("/openapi") || path.StartsWithSegments("/scalar") || path.StartsWithSegments("/hubs"))
        {
            await _next(context);
            return;
        }

        var start = Stopwatch.GetTimestamp();

        try
        {
            await _next(context);
        }
        finally
        {
            var elapsedMs = Stopwatch.GetElapsedTime(start).TotalMilliseconds;
            var status = context.Response?.StatusCode;

            audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "activity",
                eventName: "http.request.completed",
                httpContext: context,
                success: status is >= 200 and < 400,
                statusCode: status,
                category: "http",
                message: "Mutating request completed",
                dataJson: $"{{\"elapsedMs\":{elapsedMs:0.0}}}"));
        }
    }
}
