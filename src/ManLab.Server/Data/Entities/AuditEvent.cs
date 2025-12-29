using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Durable activity/audit event persisted by the server.
///
/// Design goals:
/// - Append-only (operationally)
/// - Queryable by timestamp + common dimensions (node/command/event)
/// - Safe by default (bounded fields, avoid storing secrets)
/// - Correlatable with traces (TraceId/SpanId/RequestId)
/// </summary>
[Table("AuditEvents")]
public sealed class AuditEvent
{
    [Key]
    public Guid Id { get; set; }

    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Event kind (e.g. "activity" or "audit").
    /// Keep this as a short string to remain forward-compatible.
    /// </summary>
    [Required]
    [MaxLength(16)]
    public string Kind { get; set; } = "activity";

    /// <summary>
    /// Stable canonical event name (e.g. "command.enqueued", "agent.registered").
    /// </summary>
    [Required]
    [MaxLength(128)]
    public string EventName { get; set; } = string.Empty;

    /// <summary>
    /// Optional category for grouping (e.g. "commands", "agents", "security").
    /// </summary>
    [MaxLength(64)]
    public string? Category { get; set; }

    /// <summary>
    /// Optional freeform message (keep short; no secrets).
    /// </summary>
    [MaxLength(512)]
    public string? Message { get; set; }

    public bool? Success { get; set; }

    /// <summary>
    /// Where the event originated: "http", "signalr", or "system".
    /// </summary>
    [MaxLength(16)]
    public string? Source { get; set; }

    // Actor (who initiated the action)
    [MaxLength(32)]
    public string? ActorType { get; set; } // e.g. dashboard, agent, system

    [MaxLength(128)]
    public string? ActorId { get; set; } // e.g. user id, node id

    [MaxLength(128)]
    public string? ActorName { get; set; }

    [MaxLength(64)]
    public string? ActorIp { get; set; }

    [MaxLength(256)]
    public string? UserAgent { get; set; }

    // Common subjects
    public Guid? NodeId { get; set; }
    public Guid? CommandId { get; set; }
    public Guid? SessionId { get; set; }
    public Guid? MachineId { get; set; }

    // HTTP context (when Source == http)
    [MaxLength(16)]
    public string? HttpMethod { get; set; }

    [MaxLength(512)]
    public string? HttpPath { get; set; }

    public int? HttpStatusCode { get; set; }

    // SignalR context (when Source == signalr)
    [MaxLength(64)]
    public string? Hub { get; set; }

    [MaxLength(128)]
    public string? HubMethod { get; set; }

    [MaxLength(128)]
    public string? ConnectionId { get; set; }

    // Correlation
    [MaxLength(64)]
    public string? RequestId { get; set; }

    [MaxLength(32)]
    public string? TraceId { get; set; }

    [MaxLength(16)]
    public string? SpanId { get; set; }

    /// <summary>
    /// Optional structured data for the event as JSON.
    /// Kept intentionally small; do not store secrets or large payloads.
    /// </summary>
    public string? DataJson { get; set; }

    [MaxLength(2048)]
    public string? Error { get; set; }
}
