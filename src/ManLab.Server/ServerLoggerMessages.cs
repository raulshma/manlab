using Microsoft.Extensions.Logging;

namespace ManLab.Server;

/// <summary>
/// High-performance logging methods using LoggerMessage source generator.
/// These avoid boxing and string allocations in hot paths.
/// </summary>
public static partial class ServerLoggerMessages
{
    // ===== AgentHub Hot Paths =====

    [LoggerMessage(Level = LogLevel.Debug, Message = "Heartbeat received from node: {NodeId}")]
    public static partial void HeartbeatReceived(this ILogger logger, Guid nodeId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Agent connected: {ConnectionId}")]
    public static partial void AgentConnected(this ILogger logger, string connectionId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Agent disconnected: {ConnectionId}, Reason: {Reason}")]
    public static partial void AgentDisconnected(this ILogger logger, string connectionId, string? reason);

    [LoggerMessage(Level = LogLevel.Information, Message = "Agent registering: {Hostname}")]
    public static partial void AgentRegistering(this ILogger logger, string hostname);

    [LoggerMessage(Level = LogLevel.Information, Message = "Registered new node: {NodeId} ({Hostname})")]
    public static partial void NodeRegistered(this ILogger logger, Guid nodeId, string hostname);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Rejected heartbeat for node {NodeId}: connection bound to node {RegisteredNodeId}")]
    public static partial void HeartbeatRejected(this ILogger logger, Guid nodeId, Guid registeredNodeId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Command status update: {CommandId} -> {Status}")]
    public static partial void CommandStatusUpdate(this ILogger logger, Guid commandId, string status);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Status update for unknown command: {CommandId}")]
    public static partial void UnknownCommandStatusUpdate(this ILogger logger, Guid commandId);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Terminal output received for session {SessionId}: {Length} chars, closed={IsClosed}")]
    public static partial void TerminalOutputReceived(this ILogger logger, Guid sessionId, int length, bool isClosed);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Terminal output received for unknown session {SessionId}")]
    public static partial void UnknownTerminalSession(this ILogger logger, Guid sessionId);

    [LoggerMessage(Level = LogLevel.Debug, Message = "Client {ConnectionId} subscribed to terminal session {SessionId}")]
    public static partial void TerminalSubscribed(this ILogger logger, string connectionId, Guid sessionId);

    // ===== CommandDispatchService =====

    [LoggerMessage(Level = LogLevel.Information, Message = "CommandDispatchService started. Interval={IntervalSeconds}s BatchSize={BatchSize}")]
    public static partial void CommandDispatchStarted(this ILogger logger, double intervalSeconds, int batchSize);

    [LoggerMessage(Level = LogLevel.Information, Message = "CommandDispatchService stopped")]
    public static partial void CommandDispatchStopped(this ILogger logger);

    [LoggerMessage(Level = LogLevel.Error, Message = "Command dispatch loop failed")]
    public static partial void CommandDispatchLoopFailed(this ILogger logger, Exception ex);

    // ===== HealthMonitorService =====

    [LoggerMessage(Level = LogLevel.Information, Message = "HealthMonitorService started. Interval={IntervalSeconds}s Threshold={ThresholdSeconds}s")]
    public static partial void HealthMonitorStarted(this ILogger logger, double intervalSeconds, double thresholdSeconds);

    [LoggerMessage(Level = LogLevel.Information, Message = "HealthMonitorService stopped")]
    public static partial void HealthMonitorStopped(this ILogger logger);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Node marked Offline due to missed heartbeats: {NodeId} ({Hostname}) LastSeen={LastSeen}")]
    public static partial void NodeMarkedOffline(this ILogger logger, Guid nodeId, string hostname, DateTime lastSeen);

    [LoggerMessage(Level = LogLevel.Error, Message = "Health monitor loop failed")]
    public static partial void HealthMonitorLoopFailed(this ILogger logger, Exception ex);

    // ===== DevicesController =====

    [LoggerMessage(Level = LogLevel.Information, Message = "Command queued: {CommandId} for node {NodeId}, type: {CommandType}")]
    public static partial void CommandQueued(this ILogger logger, Guid commandId, Guid nodeId, string commandType);

    [LoggerMessage(Level = LogLevel.Information, Message = "Deleted node: {NodeId} ({Hostname})")]
    public static partial void NodeDeleted(this ILogger logger, Guid nodeId, string hostname);

    [LoggerMessage(Level = LogLevel.Information, Message = "Sending uninstall command to connected agent for node {NodeId}")]
    public static partial void SendingUninstallCommand(this ILogger logger, Guid nodeId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Cannot request ping for node {NodeId}: agent not connected")]
    public static partial void PingRequestFailed(this ILogger logger, Guid nodeId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Admin ping request sent to node {NodeId}")]
    public static partial void PingRequestSent(this ILogger logger, Guid nodeId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Cannot wake node {NodeId}: no MAC address stored")]
    public static partial void WakeFailedNoMac(this ILogger logger, Guid nodeId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Cannot wake node {NodeId}: node is already online")]
    public static partial void WakeFailedAlreadyOnline(this ILogger logger, Guid nodeId);

    [LoggerMessage(Level = LogLevel.Warning, Message = "Failed to send WoL packet to node {NodeId}")]
    public static partial void WolPacketFailed(this ILogger logger, Guid nodeId);

    [LoggerMessage(Level = LogLevel.Information, Message = "Wake-on-LAN packet sent to node {NodeId} ({MacAddress})")]
    public static partial void WolPacketSent(this ILogger logger, Guid nodeId, string macAddress);

    // ===== RetentionCleanupService =====

    [LoggerMessage(Level = LogLevel.Information, Message = "Retention cleanup deleted rows: Telemetry={Telemetry} Service={Service} SMART={Smart} GPU={Gpu} UPS={Ups}")]
    public static partial void RetentionCleanupCompleted(this ILogger logger, int telemetry, int service, int smart, int gpu, int ups);

    [LoggerMessage(Level = LogLevel.Error, Message = "Retention cleanup failed")]
    public static partial void RetentionCleanupFailed(this ILogger logger, Exception ex);
}
