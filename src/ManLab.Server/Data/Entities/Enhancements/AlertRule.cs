using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Server-side alert rule definition.
/// </summary>
[Table("AlertRules")]
public sealed class AlertRule
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    [MaxLength(255)]
    public string Name { get; set; } = string.Empty;

    public bool Enabled { get; set; } = true;

    public AlertScope Scope { get; set; } = AlertScope.Global;

    public Guid? NodeId { get; set; }

    /// <summary>
    /// JSON condition payload (metric + comparator + duration, etc.).
    /// </summary>
    [Required]
    [Column(TypeName = "jsonb")]
    public string Condition { get; set; } = "{}";

    public AlertSeverity Severity { get; set; } = AlertSeverity.Warning;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Node? Node { get; set; }
    public ICollection<AlertEvent> Events { get; set; } = [];
}
