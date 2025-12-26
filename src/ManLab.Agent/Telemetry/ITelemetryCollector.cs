using ManLab.Shared.Dtos;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Interface for platform-specific telemetry collectors.
/// </summary>
public interface ITelemetryCollector
{
    /// <summary>
    /// Collects current system telemetry data.
    /// </summary>
    /// <returns>Telemetry data containing CPU, RAM, Disk, and Temperature metrics.</returns>
    TelemetryData Collect();
}
