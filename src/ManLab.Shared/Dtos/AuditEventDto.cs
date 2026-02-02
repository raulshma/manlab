namespace ManLab.Shared.Dtos;

/// <summary>
/// Audit event DTO for NATS messaging.
/// Mirror of Server.Data.Entities.AuditEvent without EF Core attributes.
/// </summary>
public sealed class AuditEventDto
{
    public Guid Id { get; set; }
    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;
    public string Kind { get; set; } = "activity";
    public string EventName { get; set; } = string.Empty;
    public string? Category { get; set; }
    public string? Message { get; set; }
    public bool? Success { get; set; }
    public string? Source { get; set; }
    public string? ActorType { get; set; }
    public string? ActorId { get; set; }
    public string? ActorName { get; set; }
    public string? ActorIp { get; set; }
    public string? UserAgent { get; set; }
    public Guid? NodeId { get; set; }
    public Guid? CommandId { get; set; }
    public Guid? SessionId { get; set; }
    public Guid? MachineId { get; set; }
    public string? HttpMethod { get; set; }
    public string? HttpPath { get; set; }
    public int? HttpStatusCode { get; set; }
    public string? Hub { get; set; }
    public string? HubMethod { get; set; }
    public string? ConnectionId { get; set; }
    public string? RequestId { get; set; }
    public string? TraceId { get; set; }
    public string? SpanId { get; set; }
    public string? DataJson { get; set; }
    public string? Error { get; set; }
}
