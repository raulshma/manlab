using Microsoft.Extensions.Logging;

namespace ManLab.Agent;

/// <summary>
/// High-performance logging using source generators.
/// These avoid boxing and string allocations when logging is disabled.
/// </summary>
internal static partial class Log
{
    // ============ ConnectionManager ============

    [LoggerMessage(Level = LogLevel.Information, Message = "Dispatching command {CommandId}: {Type}")]
    public static partial void CommandDispatching(ILogger logger, Guid commandId, string type);

    [LoggerMessage(Level = LogLevel.Information, Message = "Command cancelled: {CommandId}")]
    public static partial void CommandCancelled(ILogger logger, Guid commandId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Command not supported: {Type}")]
    public static partial void CommandNotSupported(ILogger logger, Exception ex, string type);

    [LoggerMessage(Level = LogLevel.Error, Message = "Command execution failed: {CommandId}")]
    public static partial void CommandExecutionFailed(ILogger logger, Exception ex, Guid commandId);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Heartbeat sent successfully")]
    public static partial void HeartbeatSent(ILogger logger);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Skipping heartbeat due to backoff (failures: {Failures}, next retry: {NextRetry})")]
    public static partial void HeartbeatSkippedBackoff(ILogger logger, int failures, DateTime? nextRetry);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Failed to send heartbeat")]
    public static partial void HeartbeatFailed(ILogger logger, Exception ex);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Command status updated: {CommandId} -> {Status}")]
    public static partial void CommandStatusUpdated(ILogger logger, Guid commandId, string status);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Service status snapshots sent: {Count}")]
    public static partial void ServiceSnapshotsSent(ILogger logger, int count);

    [LoggerMessage(Level = LogLevel.Debug, Message = "SMART drive snapshots sent: {Count}")]
    public static partial void SmartSnapshotsSent(ILogger logger, int count);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Terminal output sent for session {SessionId}: {Length} chars, closed={IsClosed}")]
    public static partial void TerminalOutputSent(ILogger logger, Guid sessionId, int length, bool isClosed);

    // ============ TelemetryService ============

    [LoggerMessage(Level = LogLevel.Debug, Message = "Telemetry collected - CPU: {CpuPercent:F1}%, RAM: {RamUsedMb}/{RamTotalMb} MB, Disks: {DiskCount}")]
    public static partial void TelemetryCollected(ILogger logger, double cpuPercent, long ramUsedMb, long ramTotalMb, int diskCount);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Error in telemetry loop, will retry")]
    public static partial void TelemetryLoopError(ILogger logger, Exception ex);

    [LoggerMessage(Level = LogLevel.Information, Message = "Telemetry service started (interval: {IntervalSeconds}s)")]
    public static partial void TelemetryServiceStarted(ILogger logger, int intervalSeconds);

    [LoggerMessage(Level = LogLevel.Information, Message = "Telemetry service stopped")]
    public static partial void TelemetryServiceStopped(ILogger logger);

    // ============ GpuTelemetryCollector ============

    [LoggerMessage(Level = LogLevel.Debug, Message = "GPU telemetry collection failed")]
    public static partial void GpuTelemetryFailed(ILogger logger, Exception ex);

    // ============ Connection lifecycle ============

    [LoggerMessage(Level = LogLevel.Information, Message = "Starting connection to server: {ServerUrl}")]
    public static partial void ConnectionStarting(ILogger logger, string serverUrl);

    [LoggerMessage(Level = LogLevel.Information, Message = "Connected to server successfully")]
    public static partial void ConnectionEstablished(ILogger logger);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Failed to connect to server (attempt {Attempt}). Retrying in {DelaySeconds}s...")]
    public static partial void ConnectionRetrying(ILogger logger, Exception ex, int attempt, double delaySeconds);

    [LoggerMessage(Level = LogLevel.Information, Message = "Registered successfully. Node ID: {NodeId}")]
    public static partial void RegistrationComplete(ILogger logger, Guid nodeId);

    [LoggerMessage(Level = LogLevel.Error, Message = "Failed to register with server")]
    public static partial void RegistrationFailed(ILogger logger, Exception ex);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Connection closed unexpectedly")]
    public static partial void ConnectionClosedUnexpectedly(ILogger logger, Exception? ex);

    [LoggerMessage(Level = LogLevel.Information, Message = "Connection closed")]
    public static partial void ConnectionClosed(ILogger logger);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Connection lost. Attempting to reconnect...")]
    public static partial void ConnectionReconnecting(ILogger logger);

    [LoggerMessage(Level = LogLevel.Information, Message = "Reconnected to server. Connection ID: {ConnectionId}")]
    public static partial void ConnectionReconnected(ILogger logger, string? connectionId);

    // ============ File Streaming ============

    [LoggerMessage(Level = LogLevel.Information, Message = "Starting file stream for download {DownloadId}, path: {FilePath}, chunkSize: {ChunkSize}")]
    public static partial void FileStreamStarting(ILogger logger, Guid downloadId, string filePath, int chunkSize);

    [LoggerMessage(Level = LogLevel.Information, Message = "File stream completed for download {DownloadId}")]
    public static partial void FileStreamCompleted(ILogger logger, Guid downloadId);
}
