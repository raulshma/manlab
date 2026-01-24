using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Configuration for an HTTP/API health monitor.
/// </summary>
[Table("HttpMonitorConfigs")]
public sealed class HttpMonitorConfig
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    [MaxLength(128)]
    public string Name { get; set; } = string.Empty;

    [Required]
    [MaxLength(2048)]
    public string Url { get; set; } = string.Empty;

    [MaxLength(16)]
    public string Method { get; set; } = "GET";

    public int? ExpectedStatus { get; set; }

    [MaxLength(2048)]
    public string? BodyContains { get; set; }

    public int TimeoutMs { get; set; } = 5000;

    [MaxLength(64)]
    public string Cron { get; set; } = "*/60 * * * * ?";

    public bool Enabled { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastRunAtUtc { get; set; }

    public DateTime? LastSuccessAtUtc { get; set; }
}
