using ManLab.Server.Data;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers;

/// <summary>
/// Query API for server activity/audit events.
///
/// Note: This is intentionally read-only and does not expose mutation endpoints.
/// </summary>
[ApiController]
[Route("api/audit-events")]
public sealed class AuditEventsController : ControllerBase
{
    private readonly DataContext _db;

    public AuditEventsController(DataContext db)
    {
        _db = db;
    }

    public sealed record AuditEventDto(
        Guid Id,
        DateTime TimestampUtc,
        string Kind,
        string EventName,
        string? Category,
        string? Message,
        bool? Success,
        string? Source,
        string? ActorType,
        string? ActorId,
        string? ActorName,
        string? ActorIp,
        Guid? NodeId,
        Guid? CommandId,
        Guid? SessionId,
        Guid? MachineId,
        int? HttpStatusCode,
        string? HttpMethod,
        string? HttpPath,
        string? Hub,
        string? HubMethod,
        string? ConnectionId,
        string? RequestId,
        string? TraceId,
        string? SpanId,
        string? DataJson,
        string? Error);

    /// <summary>
    /// Gets audit/activity events.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<AuditEventDto>>> Get(
        [FromQuery] DateTime? fromUtc = null,
        [FromQuery] DateTime? toUtc = null,
        [FromQuery] string? kind = null,
        [FromQuery] string? category = null,
        [FromQuery] string? eventName = null,
        [FromQuery] Guid? nodeId = null,
        [FromQuery] Guid? commandId = null,
        [FromQuery] int take = 200)
    {
        take = Math.Clamp(take, 1, 2000);

        var q = _db.AuditEvents.AsNoTracking().AsQueryable();

        if (fromUtc is not null)
        {
            q = q.Where(e => e.TimestampUtc >= fromUtc.Value);
        }

        if (toUtc is not null)
        {
            q = q.Where(e => e.TimestampUtc <= toUtc.Value);
        }

        if (!string.IsNullOrWhiteSpace(kind))
        {
            kind = kind.Trim();
            q = q.Where(e => e.Kind == kind);
        }

        if (!string.IsNullOrWhiteSpace(category))
        {
            category = category.Trim();
            q = q.Where(e => e.Category == category);
        }

        if (!string.IsNullOrWhiteSpace(eventName))
        {
            eventName = eventName.Trim();
            q = q.Where(e => e.EventName == eventName);
        }

        if (nodeId is not null)
        {
            q = q.Where(e => e.NodeId == nodeId);
        }

        if (commandId is not null)
        {
            q = q.Where(e => e.CommandId == commandId);
        }

        var items = await q
            .OrderByDescending(e => e.TimestampUtc)
            .Take(take)
            .Select(e => new AuditEventDto(
                e.Id,
                e.TimestampUtc,
                e.Kind,
                e.EventName,
                e.Category,
                e.Message,
                e.Success,
                e.Source,
                e.ActorType,
                e.ActorId,
                e.ActorName,
                e.ActorIp,
                e.NodeId,
                e.CommandId,
                e.SessionId,
                e.MachineId,
                e.HttpStatusCode,
                e.HttpMethod,
                e.HttpPath,
                e.Hub,
                e.HubMethod,
                e.ConnectionId,
                e.RequestId,
                e.TraceId,
                e.SpanId,
                e.DataJson,
                e.Error))
            .ToListAsync();

        return Ok(items);
    }
}
