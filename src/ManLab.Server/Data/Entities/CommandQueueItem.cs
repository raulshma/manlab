using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents a command queued for execution on an agent node.
/// </summary>
[Table("CommandQueue")]
public class CommandQueueItem
{
    /// <summary>Unique identifier for the command.</summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>Foreign key to the target node.</summary>
    public Guid NodeId { get; set; }

    /// <summary>Type of command to execute.</summary>
    public CommandType CommandType { get; set; }

    /// <summary>JSON payload containing command-specific parameters.</summary>
    [Column(TypeName = "jsonb")]
    public string? Payload { get; set; }

    /// <summary>Current execution status of the command.</summary>
    public CommandStatus Status { get; set; } = CommandStatus.Queued;

    /// <summary>Output/logs from command execution.</summary>
    public string? OutputLog { get; set; }

    /// <summary>When the command was created/queued.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>When the command was executed (null if not yet executed).</summary>
    public DateTime? ExecutedAt { get; set; }

    // Navigation property
    [ForeignKey(nameof(NodeId))]
    public Node Node { get; set; } = null!;
}
