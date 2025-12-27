using System.ComponentModel.DataAnnotations;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Represents a system-wide configuration setting.
/// </summary>
public class SystemSetting
{
    /// <summary>
    /// The unique key for the setting (e.g., "Discord.WebhookUrl").
    /// </summary>
    [Key]
    public required string Key { get; set; }

    /// <summary>
    /// The value of the setting.
    /// </summary>
    public string? Value { get; set; }

    /// <summary>
    /// A description of what this setting controls.
    /// </summary>
    public string? Description { get; set; }

    /// <summary>
    /// The category this setting belongs to (e.g., "Notifications", "Agent").
    /// </summary>
    public required string Category { get; set; }
}
