using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Per-node service monitoring configuration.
/// </summary>
[Table("ServiceMonitorConfigs")]
public sealed class ServiceMonitorConfig
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    public Guid NodeId { get; set; }

    [Required]
    [MaxLength(256)]
    public string ServiceName { get; set; } = string.Empty;

    public bool Enabled { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Node? Node { get; set; }
}
