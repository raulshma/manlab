using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Snapshot of GPU metrics.
/// </summary>
[Table("GpuSnapshots")]
public sealed class GpuSnapshot
{
    [Key]
    public long Id { get; set; }

    [Required]
    public Guid NodeId { get; set; }

    public DateTime Timestamp { get; set; }

    public int GpuIndex { get; set; }

    public GpuVendor Vendor { get; set; } = GpuVendor.Unknown;

    [MaxLength(255)]
    public string? Name { get; set; }

    public float? UtilizationPercent { get; set; }

    public long? MemoryUsedBytes { get; set; }

    public long? MemoryTotalBytes { get; set; }

    public float? TemperatureC { get; set; }

    // Navigation
    public Node? Node { get; set; }
}
