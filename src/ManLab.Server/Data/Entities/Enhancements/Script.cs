using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Server-defined script.
/// </summary>
[Table("Scripts")]
public sealed class Script
{
    public const int MaxContentChars = 100_000;

    [Key]
    public Guid Id { get; set; }

    [Required]
    [MaxLength(255)]
    public string Name { get; set; } = string.Empty;

    [MaxLength(2048)]
    public string? Description { get; set; }

    public ScriptShell Shell { get; set; } = ScriptShell.Bash;

    [Required]
    [MaxLength(MaxContentChars)]
    public string Content { get; set; } = string.Empty;

    public bool IsReadOnly { get; set; }

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public ICollection<ScriptRun> Runs { get; set; } = [];
}
