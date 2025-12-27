using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents a per-node configuration setting.
/// </summary>
[Table("NodeSettings")]
public sealed class NodeSetting
{
    /// <summary>The node this setting applies to.</summary>
    [Required]
    public Guid NodeId { get; set; }

    /// <summary>The unique key for the setting within a node (e.g., "agent.update.channel").</summary>
    [Required]
    [MaxLength(256)]
    public string Key { get; set; } = string.Empty;

    /// <summary>The value of the setting.</summary>
    public string? Value { get; set; }

    /// <summary>Optional description of what this setting controls.</summary>
    [MaxLength(1024)]
    public string? Description { get; set; }

    /// <summary>Category for UI grouping (e.g., "Agent", "Updates").</summary>
    [Required]
    [MaxLength(64)]
    public string Category { get; set; } = "Agent";

    /// <summary>Last time the setting was updated.</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    // Navigation
    public Node? Node { get; set; }
}
