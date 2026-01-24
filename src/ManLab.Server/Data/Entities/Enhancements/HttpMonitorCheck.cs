using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Result snapshot for an HTTP/API health monitor check.
/// </summary>
[Table("HttpMonitorChecks")]
public sealed class HttpMonitorCheck
{
    [Key]
    public long Id { get; set; }

    public Guid MonitorId { get; set; }

    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    public int? StatusCode { get; set; }

    public bool Success { get; set; }

    public int ResponseTimeMs { get; set; }

    public bool? KeywordMatched { get; set; }

    public int? SslDaysRemaining { get; set; }

    [MaxLength(2048)]
    public string? ErrorMessage { get; set; }

    public HttpMonitorConfig? Monitor { get; set; }
}
