namespace ManLab.Server.Data.Entities.Enhancements;

/// <summary>
/// Configuration for scheduled network tool runs (server-side).
/// </summary>
public sealed class ScheduledNetworkToolConfig
{
    public Guid Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public string ToolType { get; set; } = string.Empty;

    public string? Target { get; set; }

    /// <summary>
    /// Parameters serialized as JSON (tool-specific).
    /// </summary>
    public string? ParametersJson { get; set; }

    public string Cron { get; set; } = "*/60 * * * * ?";

    public bool Enabled { get; set; } = true;

    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;

    public DateTime? LastRunAtUtc { get; set; }

    public DateTime? LastSuccessAtUtc { get; set; }
}
