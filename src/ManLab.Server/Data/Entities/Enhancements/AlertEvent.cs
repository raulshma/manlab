using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Fired instance of an <see cref="AlertRule"/>.
/// </summary>
[Table("AlertEvents")]
public sealed class AlertEvent
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    public Guid AlertRuleId { get; set; }

    public Guid? NodeId { get; set; }

    public DateTime StartedAt { get; set; }

    public DateTime? ResolvedAt { get; set; }

    public AlertEventStatus Status { get; set; } = AlertEventStatus.Open;

    [MaxLength(8192)]
    public string? Message { get; set; }

    // Navigation
    public AlertRule AlertRule { get; set; } = null!;
    public Node? Node { get; set; }
}
