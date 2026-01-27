using System.ComponentModel.DataAnnotations;
using System.ComponentModel.DataAnnotations.Schema;
using ManLab.Server.Data.Enums;
using ManLab.Server.Data.Entities.Enhancements;

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

    /// <summary>
    /// Optional JSON describing capabilities/features detected by the agent.
    /// Stored as jsonb to allow schema evolution without breaking older agents.
    /// </summary>
    [Column(TypeName = "jsonb")]
    public string? CapabilitiesJson { get; set; }

    /// <summary>
    /// Optional primary network interface selected by the agent (e.g. "eth0").
    /// </summary>
    [MaxLength(128)]
    public string? PrimaryInterface { get; set; }

    /// <summary>
    /// MAC address of the primary network interface (for Wake-on-LAN).
    /// Formatted as XX:XX:XX:XX:XX:XX.
    /// </summary>
    [MaxLength(17)]
    public string? MacAddress { get; set; }

    /// <summary>Last time the node was seen/reported.</summary>
    public DateTime LastSeen { get; set; }

    /// <summary>Current status of the node.</summary>
    public NodeStatus Status { get; set; } = NodeStatus.Offline;

    /// <summary>Error code if node is in error state (e.g., HTTP status code like 401).</summary>
    public int? ErrorCode { get; set; }

    /// <summary>Error message describing the non-transient error.</summary>
    [MaxLength(1024)]
    public string? ErrorMessage { get; set; }

    /// <summary>When the error state was first recorded.</summary>
    public DateTime? ErrorAt { get; set; }

    /// <summary>Hashed authentication key for the node.</summary>
    [MaxLength(512)]
    public string? AuthKeyHash { get; set; }

    /// <summary>When the node was first registered.</summary>
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

    // Navigation properties
    public ICollection<TelemetrySnapshot> TelemetrySnapshots { get; set; } = [];
    public ICollection<CommandQueueItem> Commands { get; set; } = [];

    // Enhancements navigation properties
    public ICollection<ServiceMonitorConfig> ServiceMonitorConfigs { get; set; } = [];
    public ICollection<ServiceStatusSnapshot> ServiceStatusSnapshots { get; set; } = [];
    public ICollection<SmartDriveSnapshot> SmartDriveSnapshots { get; set; } = [];
    public ICollection<GpuSnapshot> GpuSnapshots { get; set; } = [];
    public ICollection<UpsSnapshot> UpsSnapshots { get; set; } = [];

    public ICollection<AlertRule> AlertRules { get; set; } = [];
    public ICollection<AlertEvent> AlertEvents { get; set; } = [];

    public ICollection<ScriptRun> ScriptRuns { get; set; } = [];

    public ICollection<LogViewerPolicy> LogViewerPolicies { get; set; } = [];

    public ICollection<FileBrowserPolicy> FileBrowserPolicies { get; set; } = [];
    public ICollection<TerminalSession> TerminalSessions { get; set; } = [];

    // System update navigation properties
    public ICollection<SystemUpdateHistory> SystemUpdateHistories { get; set; } = [];
}
