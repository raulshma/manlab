using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Snapshot of UPS metrics.
/// </summary>
[Table("UpsSnapshots")]
public sealed class UpsSnapshot
{
    [Key]
    public long Id { get; set; }

    [Required]
    public Guid NodeId { get; set; }

    public DateTime Timestamp { get; set; }

    public UpsBackend Backend { get; set; } = UpsBackend.Unknown;

    public float? BatteryPercent { get; set; }

    public float? LoadPercent { get; set; }

    public bool? OnBattery { get; set; }

    public int? EstimatedRuntimeSeconds { get; set; }

    // Navigation
    public Node? Node { get; set; }
}
