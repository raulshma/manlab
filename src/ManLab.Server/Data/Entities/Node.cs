using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents an agent node registered with the ManLab server.
/// </summary>
[Table("Nodes")]
public class Node
{
    /// <summary>Unique identifier for the node.</summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>Hostname of the node.</summary>
    [Required]
    [MaxLength(255)]
    public string Hostname { get; set; } = string.Empty;

    /// <summary>IP address of the node.</summary>
    [MaxLength(45)] // IPv6 max length
    public string? IpAddress { get; set; }

    /// <summary>Operating system of the node.</summary>
    [MaxLength(100)]
    public string? OS { get; set; }

    /// <summary>Version of the ManLab agent running on the node.</summary>
    [MaxLength(50)]
    public string? AgentVersion { get; set; }

    /// <summary>Last time the node was seen/reported.</summary>
    public DateTime LastSeen { get; set; }

    /// <summary>Current status of the node.</summary>
    public NodeStatus Status { get; set; } = NodeStatus.Offline;

    /// <summary>Hashed authentication key for the node.</summary>
    [MaxLength(512)]
    public string? AuthKeyHash { get; set; }

    /// <summary>When the node was first registered.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public ICollection<TelemetrySnapshot> TelemetrySnapshots { get; set; } = [];
    public ICollection<CommandQueueItem> Commands { get; set; } = [];
}
