using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents a detailed log entry for a system update operation.
/// </summary>
[Table("SystemUpdateLogs")]
public sealed class SystemUpdateLog
{
    /// <summary>Unique identifier for this log entry.</summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>The update history entry this log belongs to.</summary>
    [Required]
    public Guid UpdateHistoryId { get; set; }

    /// <summary>When this log entry was created.</summary>
    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    /// <summary>Log level (Debug, Info, Warning, Error).</summary>
    [Required]
    [MaxLength(50)]
    public string Level { get; set; } = "Info";

    /// <summary>Log message.</summary>
    [Required]
    [MaxLength(1024)]
    public string Message { get; set; } = string.Empty;

    /// <summary>Additional details (can be large).</summary>
    public string? Details { get; set; }

    // Navigation properties
    /// <summary>The update history this log belongs to.</summary>
    public SystemUpdateHistory? UpdateHistory { get; set; }
}
