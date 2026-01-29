using System.ComponentModel.DataAnnotations;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// Configuration options for process monitoring collection and alerting.
/// </summary>
public sealed class ProcessMonitoringOptions
{
    public const string SectionName = "ProcessMonitoring";

    /// <summary>
    /// Whether process monitoring is enabled globally.
    /// </summary>
    public bool Enabled { get; set; } = true;

    /// <summary>
    /// Default number of top CPU-consuming processes to collect per node.
    /// Valid range: 1-100
    /// </summary>
    [Range(1, 100)]
    public int DefaultTopCpuCount { get; set; } = 10;

    /// <summary>
    /// Default number of top memory-consuming processes to collect per node.
    /// Valid range: 1-100
    /// </summary>
    [Range(1, 100)]
    public int DefaultTopMemoryCount { get; set; } = 10;

    /// <summary>
    /// Default refresh interval for process telemetry in seconds.
    /// Valid range: 2-300 (2 seconds to 5 minutes)
    /// </summary>
    [Range(2, 300)]
    public int DefaultRefreshIntervalSeconds { get; set; } = 5;

    /// <summary>
    /// Default CPU usage threshold for alerts (percentage 0-100).
    /// </summary>
    [Range(0, 100)]
    public double DefaultCpuAlertThreshold { get; set; } = 80.0;

    /// <summary>
    /// Default memory usage threshold for alerts (percentage 0-100).
    /// </summary>
    [Range(0, 100)]
    public double DefaultMemoryAlertThreshold { get; set; } = 80.0;

    /// <summary>
    /// Default comma-separated wildcard patterns for excluding processes from monitoring.
    /// Example: "system*,idle,sleep*"
    /// </summary>
    public string DefaultExcludePatterns { get; set; } = string.Empty;

    /// <summary>
    /// Cooldown period in minutes between repeated alerts for the same process.
    /// </summary>
    [Range(1, 1440)]
    public int AlertCooldownMinutes { get; set; } = 15;
}
