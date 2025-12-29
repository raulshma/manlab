using System.Diagnostics;
using System.Security.Claims;
using ManLab.Server.Data.Entities;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.SignalR;

namespace ManLab.Server.Services.Audit;

public static class AuditEventFactory
{
    public static AuditEvent CreateHttp(
        string kind,
        string eventName,
        HttpContext httpContext,
        bool? success = null,
        int? statusCode = null,
        Guid? nodeId = null,
        Guid? commandId = null,
        Guid? sessionId = null,
        Guid? machineId = null,
        string? category = null,
        string? message = null,
        string? dataJson = null,
        string? error = null)
    {
        var (traceId, spanId) = GetTraceIds();

        var user = httpContext.User;
        var actorName = user?.Identity?.IsAuthenticated == true ? user.Identity?.Name : null;
        var actorId = user?.FindFirstValue(ClaimTypes.NameIdentifier);

        return new AuditEvent
        {
            Kind = kind,
            EventName = eventName,
            Category = category,
            Message = message,
            Success = success,
            Source = "http",

            ActorType = user?.Identity?.IsAuthenticated == true ? "dashboard" : "anonymous",
            ActorId = actorId,
            ActorName = actorName,
            ActorIp = httpContext.Connection.RemoteIpAddress?.ToString(),
            UserAgent = httpContext.Request.Headers.UserAgent.ToString(),

            NodeId = nodeId,
            CommandId = commandId,
            SessionId = sessionId,
            MachineId = machineId,

            HttpMethod = httpContext.Request.Method,
            HttpPath = httpContext.Request.Path.ToString(),
            HttpStatusCode = statusCode,

            RequestId = httpContext.TraceIdentifier,
            TraceId = traceId,
            SpanId = spanId,
            DataJson = dataJson,
            Error = error
        };
    }

    public static AuditEvent CreateSignalR(
        string kind,
        string eventName,
        HubCallerContext context,
        string? hub,
        string? hubMethod,
        bool? success = null,
        Guid? nodeId = null,
        Guid? commandId = null,
        Guid? sessionId = null,
        string? category = null,
        string? message = null,
        string? dataJson = null,
        string? error = null)
    {
        var (traceId, spanId) = GetTraceIds();

        var http = context.GetHttpContext();

        return new AuditEvent
        {
            Kind = kind,
            EventName = eventName,
            Category = category,
            Message = message,
            Success = success,
            Source = "signalr",

            ActorType = "agent",
            ActorId = nodeId?.ToString("D"),
            ActorIp = http?.Connection.RemoteIpAddress?.ToString(),
            UserAgent = http?.Request.Headers.UserAgent.ToString(),

            NodeId = nodeId,
            CommandId = commandId,
            SessionId = sessionId,

            Hub = hub,
            HubMethod = hubMethod,
            ConnectionId = context.ConnectionId,

            RequestId = http?.TraceIdentifier,
            TraceId = traceId,
            SpanId = spanId,
            DataJson = dataJson,
            Error = error
        };
    }

    private static (string? traceId, string? spanId) GetTraceIds()
    {
        var act = Activity.Current;
        if (act is null)
        {
            return (null, null);
        }

        return (act.TraceId.ToString(), act.SpanId.ToString());
    }
}
