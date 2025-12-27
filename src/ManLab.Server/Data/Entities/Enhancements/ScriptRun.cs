using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Audit/execution record for a script run.
/// Output fields are expected to be bounded tails.
/// </summary>
[Table("ScriptRuns")]
public sealed class ScriptRun
{
    public const int MaxTailBytesUtf8 = 64 * 1024;

    [Key]
    public Guid Id { get; set; }

    [Required]
    public Guid ScriptId { get; set; }

    [Required]
    public Guid NodeId { get; set; }

    [MaxLength(128)]
    public string? RequestedBy { get; set; }

    public ScriptRunStatus Status { get; set; } = ScriptRunStatus.Queued;

    public string? StdoutTail { get; set; }

    public string? StderrTail { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? StartedAt { get; set; }

    public DateTime? FinishedAt { get; set; }

    // Navigation
    public Script Script { get; set; } = null!;
    public Node Node { get; set; } = null!;
}
