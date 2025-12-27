using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Ephemeral, auditable terminal session.
/// </summary>
[Table("TerminalSessions")]
public sealed class TerminalSession
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    public Guid NodeId { get; set; }

    [MaxLength(128)]
    public string? RequestedBy { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime ExpiresAt { get; set; }

    public DateTime? ClosedAt { get; set; }

    public TerminalSessionStatus Status { get; set; } = TerminalSessionStatus.Open;

    // Navigation
    public Node? Node { get; set; }
}
