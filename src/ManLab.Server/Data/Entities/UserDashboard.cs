using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents a shared dashboard configuration accessible to all users in the organization.
/// </summary>
[Table("UserDashboards")]
public class UserDashboard
{
    /// <summary>Unique identifier for dashboard.</summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>Display name for this dashboard layout.</summary>
    [Required]
    [MaxLength(255)]
    public string Name { get; set; } = "Default Dashboard";

    /// <summary>JSON serialized layout configuration containing widget positions and settings.</summary>
    [Required]
    [Column(TypeName = "jsonb")]
    public string LayoutJson { get; set; } = "{}";

    /// <summary>When the dashboard was last updated.</summary>
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    /// <summary>Whether this is the default dashboard shown to all users.</summary>
    public bool IsDefault { get; set; } = true;

    /// <summary>Widgets configured for this dashboard.</summary>
    public ICollection<WidgetConfig> Widgets { get; set; } = [];
}
