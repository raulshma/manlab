using System.Text.Json.Serialization;

namespace ManLab.Shared.Dtos;

/// <summary>
/// Configuration for process monitoring with hierarchical settings.
/// </summary>
public sealed class ProcessMonitoringConfig
{
    public bool Enabled { get; set; } = true;
    public int TopCpuCount { get; set; } = 10;
    public int TopMemoryCount { get; set; } = 10;
    public int RefreshIntervalSeconds { get; set; } = 5;
    public double CpuAlertThreshold { get; set; } = 80.0;
    public double MemoryAlertThreshold { get; set; } = 80.0;
    public string[] ExcludePatterns { get; set; } = [];
}

/// <summary>
/// Context for a process alert evaluation request sent via NATS.
/// </summary>
public sealed class ProcessAlertContext
{
    public Guid NodeId { get; set; }
    public List<ProcessTelemetry> Processes { get; set; } = [];
    public ProcessMonitoringConfig Config { get; set; } = new();
}
