using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Snapshot of SMART health for a drive.
/// </summary>
[Table("SmartDriveSnapshots")]
public sealed class SmartDriveSnapshot
{
    [Key]
    public long Id { get; set; }

    [Required]
    public Guid NodeId { get; set; }

    public DateTime Timestamp { get; set; }

    [Required]
    [MaxLength(128)]
    public string Device { get; set; } = string.Empty;

    public SmartDriveHealth Health { get; set; } = SmartDriveHealth.Unknown;

    public float? TemperatureC { get; set; }

    public int? PowerOnHours { get; set; }

    /// <summary>
    /// Optional smartctl extract as JSON.
    /// </summary>
    [Column(TypeName = "jsonb")]
    public string? Raw { get; set; }

    // Navigation
    public Node? Node { get; set; }
}
