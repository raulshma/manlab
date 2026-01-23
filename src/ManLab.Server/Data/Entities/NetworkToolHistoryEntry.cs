using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;

namespace ManLab.Server.Data.Entities;

/// <summary>
/// Persisted history entry for network tool executions.
/// Stores input parameters and results as JSON for flexibility and future analytics.
/// </summary>
[Table("NetworkToolHistory")]
public sealed class NetworkToolHistoryEntry
{
    [Key]
    public Guid Id { get; set; }

    public DateTime TimestampUtc { get; set; } = DateTime.UtcNow;

    /// <summary>
    /// Type of network tool: ping, traceroute, port-scan, subnet-scan, discovery, wifi-scan
    /// </summary>
    [Required]
    [MaxLength(32)]
    public string ToolType { get; set; } = string.Empty;

    /// <summary>
    /// Input parameters serialized as JSON.
    /// </summary>
    public string? InputJson { get; set; }

    /// <summary>
    /// Tool execution result serialized as JSON.
    /// </summary>
    public string? ResultJson { get; set; }

    /// <summary>
    /// Whether the tool execution was successful.
    /// </summary>
    public bool Success { get; set; }

    /// <summary>
    /// Execution duration in milliseconds.
    /// </summary>
    public int DurationMs { get; set; }

    /// <summary>
    /// Error message if the execution failed.
    /// </summary>
    [MaxLength(2048)]
    public string? ErrorMessage { get; set; }

    /// <summary>
    /// SignalR connection ID for correlation (optional).
    /// </summary>
    [MaxLength(128)]
    public string? ConnectionId { get; set; }

    /// <summary>
    /// Primary target of the operation (e.g., host, CIDR, etc.) for quick display.
    /// </summary>
    [MaxLength(256)]
    public string? Target { get; set; }
}
