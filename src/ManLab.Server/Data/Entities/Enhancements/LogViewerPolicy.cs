using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Allowlisted log viewer policy entry for a node.
/// </summary>
[Table("LogViewerPolicies")]
public sealed class LogViewerPolicy
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    public Guid NodeId { get; set; }

    [Required]
    [MaxLength(255)]
    public string DisplayName { get; set; } = string.Empty;

    [Required]
    [MaxLength(1024)]
    public string Path { get; set; } = string.Empty;

    public int MaxBytesPerRequest { get; set; } = 64 * 1024;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Node? Node { get; set; }
}
