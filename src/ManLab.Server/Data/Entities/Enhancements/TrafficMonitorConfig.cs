using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Configuration for server-side traffic monitoring (interface stats).
/// </summary>
[Table("TrafficMonitorConfigs")]
public sealed class TrafficMonitorConfig
{
    [Key]
    public Guid Id { get; set; }

    [MaxLength(128)]
    public string? InterfaceName { get; set; }

    [MaxLength(64)]
    public string Cron { get; set; } = "*/30 * * * * ?";

    public bool Enabled { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastRunAtUtc { get; set; }
}
