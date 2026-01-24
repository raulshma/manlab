using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Traffic sample captured from a server network interface.
/// </summary>
[Table("TrafficSamples")]
public sealed class TrafficSample
{
    public long Id { get; set; }

    [MaxLength(128)]
    public string InterfaceName { get; set; } = string.Empty;

    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    public long? RxBytesPerSec { get; set; }

    public long? TxBytesPerSec { get; set; }

    public long? RxErrors { get; set; }

    public long? TxErrors { get; set; }

    public long? SpeedBps { get; set; }

    public float? UtilizationPercent { get; set; }
}
