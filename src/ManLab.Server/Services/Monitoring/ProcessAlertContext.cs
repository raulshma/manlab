using ManLab.Shared.Dtos;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// Context for a process alert evaluation request sent via NATS.
/// </summary>
public record ProcessAlertContext(
    Guid NodeId,
    List<ProcessTelemetry> Processes,
    ProcessMonitoringConfig Config);
