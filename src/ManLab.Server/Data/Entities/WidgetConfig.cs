using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents a widget configuration that can be used on dashboards.
/// </summary>
[Table("WidgetConfigs")]
public class WidgetConfig
{
    /// <summary>Unique identifier for widget config.</summary>
    [Key]
    public Guid Id { get; set; }

    /// <summary>Type identifier of the widget (e.g., "node-card", "rss-feed", "fleet-stats").</summary>
    [Required]
    [MaxLength(100)]
    public string WidgetType { get; set; } = string.Empty;

    /// <summary>JSON serialized widget-specific configuration.</summary>
    [Required]
    [Column(TypeName = "jsonb")]
    public string ConfigJson { get; set; } = "{}";

    /// <summary>Display order within the dashboard.</summary>
    public int DisplayOrder { get; set; }

    /// <summary>Column position in the grid layout (0-indexed).</summary>
    public int Column { get; set; } = 0;

    /// <summary>Row position in the grid layout (0-indexed).</summary>
    public int Row { get; set; } = 0;

    /// <summary>Column span (width) in grid units.</summary>
    public int Width { get; set; } = 1;

    /// <summary>Row span (height) in grid units.</summary>
    public int Height { get; set; } = 1;

    /// <summary>Optional width percentage (10-100) for content scaling within the cell.</summary>
    public int? WidthPercent { get; set; }

    /// <summary>Optional height percentage (10-100) for content scaling within the cell.</summary>
    public int? HeightPercent { get; set; }

    /// <summary>Whether this widget requires admin privileges to configure.</summary>
    public bool RequiresAdmin { get; set; } = false;

    /// <summary>The dashboard this widget belongs to.</summary>
    public Guid DashboardId { get; set; }

    [ForeignKey(nameof(DashboardId))]
    public UserDashboard Dashboard { get; set; } = null!;
}
