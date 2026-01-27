using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents a system update operation for a node.
/// </summary>
[Table("SystemUpdateHistory")]
public sealed class SystemUpdateHistory
{
    /// <summary>Unique identifier for this update record.</summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>The node this update applies to.</summary>
    [Required]
    public Guid NodeId { get; set; }

    /// <summary>When the update was created/queued.</summary>
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;

    /// <summary>When the update completed (null if still in progress).</summary>
    public DateTime? CompletedAt { get; set; }

    /// <summary>When the update was scheduled to run (if different from StartedAt).</summary>
    public DateTime? ScheduledAt { get; set; }

    /// <summary>Current status of the update.</summary>
    [Required]
    [MaxLength(50)]
    public string Status { get; set; } = "Pending"; // Pending, Approved, InProgress, Completed, Failed, Cancelled

    /// <summary>Type of updates being applied (e.g., Security, Feature, Driver, Critical).</summary>
    [MaxLength(50)]
    public string? UpdateType { get; set; }

    /// <summary>System state before the update (JSON).</summary>
    [Column(TypeName = "jsonb")]
    public string? PreUpdateStateJson { get; set; }

    /// <summary>System state after the update (JSON).</summary>
    [Column(TypeName = "jsonb")]
    public string? PostUpdateStateJson { get; set; }

    /// <summary>List of packages that were updated (JSON array).</summary>
    [Column(TypeName = "jsonb")]
    public string? PackagesJson { get; set; }

    /// <summary>Full output from the update command.</summary>
    public string? OutputLog { get; set; }

    /// <summary>Error message if the update failed.</summary>
    [MaxLength(2048)]
    public string? ErrorMessage { get; set; }

    /// <summary>Whether a reboot is required after this update.</summary>
    public bool RebootRequired { get; set; }

    /// <summary>Whether reboot has been approved.</summary>
    public bool RebootApproved { get; set; }

    /// <summary>When the reboot was performed (null if not yet rebooted).</summary>
    public DateTime? RebootedAt { get; set; }

    /// <summary>Type of actor that initiated this update (user, system).</summary>
    [MaxLength(32)]
    public string? ActorType { get; set; }

    /// <summary>ID of the actor who initiated this update.</summary>
    [MaxLength(128)]
    public string? ActorId { get; set; }

    // Navigation properties
    /// <summary>The node this update belongs to.</summary>
    public Node? Node { get; set; }

    /// <summary>Detailed logs for this update.</summary>
    public ICollection<SystemUpdateLog> Logs { get; set; } = [];
}
