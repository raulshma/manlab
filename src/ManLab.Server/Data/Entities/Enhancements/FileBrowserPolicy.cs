using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Allowlisted file browser policy entry for a node.
///
/// Paths are "virtual" paths using forward slashes:
/// - Unix: "/var/log"
/// - Windows drive roots: "/C", "/D", etc.
/// </summary>
[Table("FileBrowserPolicies")]
public sealed class FileBrowserPolicy
{
    [Key]
    public Guid Id { get; set; }

    [Required]
    public Guid NodeId { get; set; }

    [Required]
    [MaxLength(255)]
    public string DisplayName { get; set; } = string.Empty;

    /// <summary>
    /// Root virtual path that all requests must stay within.
    /// </summary>
    [Required]
    [MaxLength(1024)]
    public string RootPath { get; set; } = "/";

    /// <summary>
    /// Maximum bytes allowed per file.read request for this policy.
    /// (Both server and agent also enforce global bounds.)
    /// </summary>
    public int MaxBytesPerRead { get; set; } = 2 * 1024 * 1024;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Node? Node { get; set; }
}
