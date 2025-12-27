using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Snapshot of a service's status on a node.
/// </summary>
[Table("ServiceStatusSnapshots")]
public sealed class ServiceStatusSnapshot
{
    [Key]
    public long Id { get; set; }

    [Required]
    public Guid NodeId { get; set; }

    public DateTime Timestamp { get; set; }

    [Required]
    [MaxLength(256)]
    public string ServiceName { get; set; } = string.Empty;

    public ServiceState State { get; set; } = ServiceState.Unknown;

    [MaxLength(2048)]
    public string? Detail { get; set; }

    // Navigation
    public Node? Node { get; set; }
}
