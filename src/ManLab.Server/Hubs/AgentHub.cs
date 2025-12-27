using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Security;
using ManLab.Server.Services.Agents;
using ManLab.Server.Services.Enhancements;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Hubs;

/// <summary>
/// SignalR hub for agent communication.
/// Handles agent registration, telemetry heartbeats, and command status updates.
/// </summary>
public class AgentHub : Hub
{
    private const int MaxServiceNameChars = 256;
    private const int MaxServiceDetailChars = 2048;
    private const int MaxDeviceNameChars = 128;
    private const int MaxPingTargetChars = 255;
    private const int MaxRawJsonChars = 65_536;
    private const int MaxGpuEntriesPerMessage = 16;

    // Defense-in-depth bounds for hub messages and persisted command logs.
    // Keep these comfortably below HubOptions.MaximumReceiveMessageSize (currently 128KB).
    private const int MaxTerminalOutputChunkChars = 16 * 1024;
    private const int MaxCommandLogChunkChars = 32 * 1024;
    private const int MaxCommandOutputLogBytesUtf8 = 128 * 1024;

    private const string ContextNodeIdKey = "manlab.nodeId";
    private const string ContextTokenHashKey = "manlab.tokenHash";

    private const string CommandOutputGroupPrefix = "command-output";

    private readonly ILogger<AgentHub> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly AgentConnectionRegistry _connectionRegistry;

    public AgentHub(
        ILogger<AgentHub> logger,
        IServiceScopeFactory scopeFactory,
        AgentConnectionRegistry connectionRegistry)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _connectionRegistry = connectionRegistry;
    }

    /// <summary>
    /// Called when an agent connects. Logs the connection.
    /// Actual registration happens via the Register method.
    /// </summary>
    public override async Task OnConnectedAsync()
    {
        _logger.LogInformation("Agent connected: {ConnectionId}", Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    /// <summary>
    /// Called when an agent disconnects.
    /// </summary>
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.LogInformation("Agent disconnected: {ConnectionId}, Reason: {Reason}",
            Context.ConnectionId, exception?.Message ?? "Normal disconnect");

        _connectionRegistry.TryRemoveByConnectionId(Context.ConnectionId, out _);

        // Best-effort cleanup of per-connection auth context.
        Context.Items.Remove(ContextNodeIdKey);
        Context.Items.Remove(ContextTokenHashKey);

        await base.OnDisconnectedAsync(exception);
    }

    /// <summary>
    /// Registers or updates a node in the database.
    /// Called by agents on connection start.
    /// </summary>
    /// <param name="metadata">Node metadata including hostname, IP, OS, and agent version.</param>
    /// <returns>The node ID assigned to this agent.</returns>
    public async Task<Guid> Register(NodeMetadata metadata)
    {
        if (!TryGetBearerToken(out var bearerToken))
        {
            throw new HubException("Unauthorized: missing bearer token.");
        }

        var tokenHash = TokenHasher.NormalizeToSha256Hex(bearerToken);

        _logger.LogInformation("Agent registering: {Hostname}", metadata.Hostname);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Prefer binding by auth token hash.
        var authedNode = await dbContext.Nodes
            .FirstOrDefaultAsync(n => n.AuthKeyHash != null && n.AuthKeyHash == tokenHash);

        if (authedNode is not null)
        {
            var previousStatus = authedNode.Status;

            authedNode.Hostname = metadata.Hostname;
            authedNode.IpAddress = metadata.IpAddress;
            authedNode.OS = metadata.OS;
            authedNode.AgentVersion = metadata.AgentVersion;
            authedNode.CapabilitiesJson = NormalizeJsonOrNull(metadata.CapabilitiesJson);
            authedNode.PrimaryInterface = NormalizeTrimmedOrNull(metadata.PrimaryInterface, 128);
            authedNode.LastSeen = DateTime.UtcNow;
            authedNode.Status = NodeStatus.Online;

            await dbContext.SaveChangesAsync();

            // Bind the latest connectionId to this nodeId for targeted server->agent calls.
            _connectionRegistry.Set(authedNode.Id, Context.ConnectionId);

            // Bind auth context to this connection so subsequent calls (heartbeat, status updates)
            // do not require a DB round-trip just to re-validate the token.
            Context.Items[ContextNodeIdKey] = authedNode.Id;
            Context.Items[ContextTokenHashKey] = tokenHash;

            if (previousStatus != authedNode.Status)
            {
                await Clients.All.SendAsync("NodeStatusChanged", authedNode.Id, authedNode.Status.ToString(), authedNode.LastSeen);
            }

            return authedNode.Id;
        }

        // If it's an unused enrollment token, bind it to the node we create.
        var enrollment = await dbContext.EnrollmentTokens
            .Where(t => t.TokenHash == tokenHash)
            .Where(t => t.UsedAt == null)
            .Where(t => t.ExpiresAt > DateTime.UtcNow)
            .FirstOrDefaultAsync();

        if (enrollment is null)
        {
            throw new HubException("Unauthorized: invalid or expired token.");
        }

        // Create new node bound to this token.
        var newNode = new Node
        {
            Id = Guid.NewGuid(),
            Hostname = metadata.Hostname,
            IpAddress = metadata.IpAddress,
            OS = metadata.OS,
            AgentVersion = metadata.AgentVersion,
            CapabilitiesJson = NormalizeJsonOrNull(metadata.CapabilitiesJson),
            PrimaryInterface = NormalizeTrimmedOrNull(metadata.PrimaryInterface, 128),
            LastSeen = DateTime.UtcNow,
            Status = NodeStatus.Online,
            AuthKeyHash = tokenHash,
            CreatedAt = DateTime.UtcNow
        };

        dbContext.Nodes.Add(newNode);

        enrollment.UsedAt = DateTime.UtcNow;
        enrollment.NodeId = newNode.Id;

        await dbContext.SaveChangesAsync();

        _logger.LogInformation("Registered new node: {NodeId} ({Hostname})", newNode.Id, metadata.Hostname);

        // Bind the latest connectionId to this nodeId for targeted server->agent calls.
        _connectionRegistry.Set(newNode.Id, Context.ConnectionId);

        // Bind auth context to this connection.
        Context.Items[ContextNodeIdKey] = newNode.Id;
        Context.Items[ContextTokenHashKey] = tokenHash;

        // Let dashboards upsert immediately without waiting for a REST poll.
        await Clients.All.SendAsync("NodeRegistered", new NodeRegisteredDto
        {
            Id = newNode.Id,
            Hostname = newNode.Hostname,
            IpAddress = newNode.IpAddress,
            OS = newNode.OS,
            AgentVersion = newNode.AgentVersion,
            LastSeen = newNode.LastSeen,
            Status = newNode.Status.ToString(),
            CreatedAt = newNode.CreatedAt
        });

        await Clients.All.SendAsync("NodeStatusChanged", newNode.Id, newNode.Status.ToString(), newNode.LastSeen);

        return newNode.Id;
    }

    private bool TryGetRegisteredAgentContext(out Guid registeredNodeId, out string registeredTokenHash)
    {
        registeredNodeId = Guid.Empty;
        registeredTokenHash = string.Empty;

        if (!Context.Items.TryGetValue(ContextNodeIdKey, out var nodeObj) || nodeObj is not Guid nodeId)
        {
            return false;
        }

        if (!Context.Items.TryGetValue(ContextTokenHashKey, out var tokenObj) || tokenObj is not string tokenHash)
        {
            return false;
        }

        registeredNodeId = nodeId;
        registeredTokenHash = tokenHash;
        return registeredNodeId != Guid.Empty && !string.IsNullOrWhiteSpace(registeredTokenHash);
    }

    /// <summary>
    /// Receives heartbeat with telemetry data from an agent.
    /// Updates the node's LastSeen timestamp and stores telemetry snapshot.
    /// </summary>
    /// <param name="nodeId">The node ID sending the heartbeat.</param>
    /// <param name="data">Telemetry data from the agent.</param>
    public async Task SendHeartbeat(Guid nodeId, TelemetryData data)
    {
        // Heartbeats are allowed only after a successful Register(), which binds node/token to this connection.
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before sending heartbeats.");
        }

        // Prevent a connected agent from spoofing another nodeId.
        if (registeredNodeId != nodeId)
        {
            _logger.LogWarning("Rejected heartbeat for node {NodeId}: connection bound to node {RegisteredNodeId}", nodeId, registeredNodeId);
            throw new HubException("Unauthorized: nodeId does not match registered connection.");
        }

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;

        // Use ExecuteUpdateAsync for efficient update without loading entity
        await dbContext.Nodes
            .Where(n => n.Id == nodeId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(n => n.LastSeen, now)
                .SetProperty(n => n.Status, NodeStatus.Online));

        // Calculate overall disk usage (average of all mount points)
        float diskUsage = data.DiskUsage.Count > 0
            ? data.DiskUsage.Values.Average()
            : 0;

        // Calculate RAM usage percentage
        float ramUsage = data.RamTotalBytes > 0
            ? (float)data.RamUsedBytes / data.RamTotalBytes * 100
            : 0;

        // Store telemetry snapshot
        var snapshot = new TelemetrySnapshot
        {
            NodeId = nodeId,
            Timestamp = now,
            CpuUsage = data.CpuPercent,
            RamUsage = ramUsage,
            DiskUsage = diskUsage,
            Temperature = data.CpuTempCelsius,

            NetRxBytesPerSec = data.NetRxBytesPerSec,
            NetTxBytesPerSec = data.NetTxBytesPerSec,
            PingTarget = NormalizeTrimmedOrNull(data.PingTarget, MaxPingTargetChars),
            PingRttMs = data.PingRttMs,
            PingPacketLossPercent = data.PingPacketLossPercent
        };

        // Optional: persist GPU snapshots when provided in heartbeat.
        if (data.Gpus is { Count: > 0 })
        {
            foreach (var gpu in data.Gpus.Take(MaxGpuEntriesPerMessage))
            {
                dbContext.GpuSnapshots.Add(new GpuSnapshot
                {
                    NodeId = nodeId,
                    Timestamp = now,
                    GpuIndex = gpu.Index,
                    Vendor = ParseGpuVendor(gpu.Vendor),
                    Name = NormalizeTrimmedOrNull(gpu.Name, 255),
                    UtilizationPercent = gpu.UtilizationPercent,
                    MemoryUsedBytes = gpu.MemoryUsedBytes,
                    MemoryTotalBytes = gpu.MemoryTotalBytes,
                    TemperatureC = gpu.TemperatureC
                });
            }
        }

        // Optional: persist UPS snapshot when provided in heartbeat.
        if (data.Ups is not null)
        {
            dbContext.UpsSnapshots.Add(new UpsSnapshot
            {
                NodeId = nodeId,
                Timestamp = now,
                Backend = ParseUpsBackend(data.Ups.Backend),
                BatteryPercent = data.Ups.BatteryPercent,
                LoadPercent = data.Ups.LoadPercent,
                OnBattery = data.Ups.OnBattery,
                EstimatedRuntimeSeconds = data.Ups.EstimatedRuntimeSeconds
            });
        }

        dbContext.TelemetrySnapshots.Add(snapshot);
        await dbContext.SaveChangesAsync();

        _logger.LogDebug("Heartbeat received from node: {NodeId}", nodeId);

        // Node status transitions are handled on Register() (Online) and HealthMonitorService (Offline).
        // Avoid additional DB round-trips in the hot heartbeat path.

        // Let the dashboard invalidate/refetch telemetry for this node.
        await Clients.All.SendAsync("TelemetryReceived", nodeId);
    }

    /// <summary>
    /// Receives service status snapshots from an agent and persists them.
    /// </summary>
    public async Task SendServiceStatusSnapshots(Guid nodeId, List<ServiceStatusSnapshotIngest> snapshots)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before sending snapshots.");
        }

        if (registeredNodeId != nodeId)
        {
            throw new HubException("Unauthorized: nodeId does not match registered connection.");
        }

        if (snapshots is null || snapshots.Count == 0)
        {
            return;
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;
        foreach (var s in snapshots)
        {
            var serviceName = (s.ServiceName ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(serviceName))
            {
                continue;
            }

            if (serviceName.Length > MaxServiceNameChars)
            {
                serviceName = serviceName[..MaxServiceNameChars];
            }

            db.ServiceStatusSnapshots.Add(new ServiceStatusSnapshot
            {
                NodeId = nodeId,
                Timestamp = s.Timestamp ?? now,
                ServiceName = serviceName,
                State = ParseServiceState(s.State),
                Detail = Truncate(s.Detail, MaxServiceDetailChars)
            });
        }

        await db.SaveChangesAsync();
        await Clients.All.SendAsync("ServiceStatusSnapshotsReceived", nodeId);
    }

    /// <summary>
    /// Receives SMART drive snapshots from an agent and persists them.
    /// </summary>
    public async Task SendSmartDriveSnapshots(Guid nodeId, List<SmartDriveSnapshotIngest> snapshots)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before sending snapshots.");
        }

        if (registeredNodeId != nodeId)
        {
            throw new HubException("Unauthorized: nodeId does not match registered connection.");
        }

        if (snapshots is null || snapshots.Count == 0)
        {
            return;
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;
        foreach (var s in snapshots)
        {
            var device = (s.Device ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(device))
            {
                continue;
            }

            if (device.Length > MaxDeviceNameChars)
            {
                device = device[..MaxDeviceNameChars];
            }

            db.SmartDriveSnapshots.Add(new SmartDriveSnapshot
            {
                NodeId = nodeId,
                Timestamp = s.Timestamp ?? now,
                Device = device,
                Health = ParseSmartDriveHealth(s.Health),
                TemperatureC = s.TemperatureC,
                PowerOnHours = s.PowerOnHours,
                Raw = Truncate(NormalizeJsonOrNull(s.RawJson), MaxRawJsonChars)
            });
        }

        await db.SaveChangesAsync();
        await Clients.All.SendAsync("SmartDriveSnapshotsReceived", nodeId);
    }

    /// <summary>
    /// Receives GPU snapshots from an agent and persists them.
    /// </summary>
    public async Task SendGpuSnapshots(Guid nodeId, List<GpuSnapshotIngest> snapshots)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before sending snapshots.");
        }

        if (registeredNodeId != nodeId)
        {
            throw new HubException("Unauthorized: nodeId does not match registered connection.");
        }

        if (snapshots is null || snapshots.Count == 0)
        {
            return;
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;
        foreach (var s in snapshots.Take(MaxGpuEntriesPerMessage))
        {
            db.GpuSnapshots.Add(new GpuSnapshot
            {
                NodeId = nodeId,
                Timestamp = s.Timestamp ?? now,
                GpuIndex = s.GpuIndex,
                Vendor = ParseGpuVendor(s.Vendor),
                Name = NormalizeTrimmedOrNull(s.Name, 255),
                UtilizationPercent = s.UtilizationPercent,
                MemoryUsedBytes = s.MemoryUsedBytes,
                MemoryTotalBytes = s.MemoryTotalBytes,
                TemperatureC = s.TemperatureC
            });
        }

        await db.SaveChangesAsync();
        await Clients.All.SendAsync("GpuSnapshotsReceived", nodeId);
    }

    /// <summary>
    /// Receives UPS snapshots from an agent and persists them.
    /// </summary>
    public async Task SendUpsSnapshots(Guid nodeId, List<UpsSnapshotIngest> snapshots)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before sending snapshots.");
        }

        if (registeredNodeId != nodeId)
        {
            throw new HubException("Unauthorized: nodeId does not match registered connection.");
        }

        if (snapshots is null || snapshots.Count == 0)
        {
            return;
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;
        foreach (var s in snapshots)
        {
            db.UpsSnapshots.Add(new UpsSnapshot
            {
                NodeId = nodeId,
                Timestamp = s.Timestamp ?? now,
                Backend = ParseUpsBackend(s.Backend),
                BatteryPercent = s.BatteryPercent,
                LoadPercent = s.LoadPercent,
                OnBattery = s.OnBattery,
                EstimatedRuntimeSeconds = s.EstimatedRuntimeSeconds
            });
        }

        await db.SaveChangesAsync();
        await Clients.All.SendAsync("UpsSnapshotsReceived", nodeId);
    }

    /// <summary>
    /// Receives terminal output from an agent and broadcasts to subscribed clients.
    /// </summary>
    /// <param name="sessionId">The terminal session ID.</param>
    /// <param name="output">The output chunk from the terminal.</param>
    /// <param name="isClosed">True if the session has ended.</param>
    public async Task SendTerminalOutput(Guid sessionId, string output, bool isClosed)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before sending terminal output.");
        }

        // Verify session belongs to the registered node
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var session = await db.TerminalSessions
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == sessionId);

        if (session is null)
        {
            _logger.LogWarning("Terminal output received for unknown session {SessionId}", sessionId);
            return;
        }

        if (session.NodeId != registeredNodeId)
        {
            _logger.LogWarning(
                "Rejected terminal output for session {SessionId}: session belongs to node {SessionNodeId} but connection is bound to {RegisteredNodeId}",
                sessionId, session.NodeId, registeredNodeId);
            throw new HubException("Unauthorized: session does not belong to this agent.");
        }

        // Update session status if closed
        if (isClosed && session.Status == TerminalSessionStatus.Open)
        {
            var sessionService = scope.ServiceProvider.GetRequiredService<TerminalSessionService>();
            await sessionService.MarkExpiredAsync(sessionId);
        }

        // Bound the per-message output chunk to reduce memory pressure and avoid oversize broadcasts.
        output ??= string.Empty;
        if (output.Length > MaxTerminalOutputChunkChars)
        {
            output = output[..MaxTerminalOutputChunkChars] + "\n[...output truncated by server...]\n";
        }

        _logger.LogDebug("Terminal output received for session {SessionId}: {Length} chars, closed={IsClosed}",
            sessionId, output.Length, isClosed);

        // Broadcast to subscribed dashboard clients
        await Clients.Group(GetTerminalOutputGroup(sessionId))
            .SendAsync("TerminalOutput", sessionId, output ?? string.Empty, isClosed);
    }

    /// <summary>
    /// Allows dashboard clients to subscribe to terminal output for a session.
    /// </summary>
    public async Task SubscribeTerminalOutput(Guid sessionId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, GetTerminalOutputGroup(sessionId));
        _logger.LogDebug("Client {ConnectionId} subscribed to terminal session {SessionId}", Context.ConnectionId, sessionId);
    }

    /// <summary>
    /// Allows dashboard clients to unsubscribe from terminal output.
    /// </summary>
    public async Task UnsubscribeTerminalOutput(Guid sessionId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GetTerminalOutputGroup(sessionId));
    }

    private static string GetTerminalOutputGroup(Guid sessionId)
        => $"terminal-output.{sessionId:N}";

    private static string? NormalizeTrimmedOrNull(string? s, int maxLen)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        if (s.Length == 0) return null;
        return s.Length <= maxLen ? s : s[..maxLen];
    }

    private static string? Truncate(string? s, int maxLen)
    {
        if (string.IsNullOrEmpty(s)) return s;
        if (s.Length <= maxLen) return s;
        return s[..maxLen];
    }

    private static string? NormalizeJsonOrNull(string? json)
    {
        if (string.IsNullOrWhiteSpace(json)) return null;

        // We store as jsonb; Postgres will validate/parse, but we'd rather reject obvious junk.
        // Keep validation lightweight to avoid expensive work in hot paths.
        json = json.Trim();
        if (json.Length == 0) return null;

        // Basic sanity check: must look like JSON object/array.
        var c = json[0];
        if (c is not '{' and not '[')
        {
            return null;
        }

        return json;
    }

    private static ServiceState ParseServiceState(string? state)
    {
        var s = (state ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "active" => ServiceState.Active,
            "inactive" => ServiceState.Inactive,
            "failed" => ServiceState.Failed,
            "unknown" or "" => ServiceState.Unknown,
            _ => ServiceState.Unknown
        };
    }

    private static SmartDriveHealth ParseSmartDriveHealth(string? health)
    {
        var s = (health ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "pass" => SmartDriveHealth.Pass,
            "fail" => SmartDriveHealth.Fail,
            "unknown" or "" => SmartDriveHealth.Unknown,
            _ => SmartDriveHealth.Unknown
        };
    }

    private static GpuVendor ParseGpuVendor(string? vendor)
    {
        var s = (vendor ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "nvidia" => GpuVendor.Nvidia,
            "intel" => GpuVendor.Intel,
            "amd" => GpuVendor.AMD,
            "unknown" or "" => GpuVendor.Unknown,
            _ => GpuVendor.Unknown
        };
    }

    private static UpsBackend ParseUpsBackend(string? backend)
    {
        var s = (backend ?? string.Empty).Trim().ToLowerInvariant();
        return s switch
        {
            "nut" => UpsBackend.Nut,
            "apcupsd" => UpsBackend.Apcupsd,
            "unknown" or "" => UpsBackend.Unknown,
            _ => UpsBackend.Unknown
        };
    }

    /// <summary>
    /// Updates the status of a command in the queue.
    /// Called by agents when command execution state changes.
    /// </summary>
    /// <param name="commandId">The command ID being updated.</param>
    /// <param name="status">The new status (InProgress, Success, Failed).</param>
    /// <param name="logs">Output/logs from command execution.</param>
    public async Task UpdateCommandStatus(Guid commandId, string status, string? logs)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before updating command status.");
        }

        _logger.LogInformation("Command status update: {CommandId} -> {Status}", commandId, status);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        var command = await dbContext.CommandQueue.FindAsync(commandId);
        if (command == null)
        {
            _logger.LogWarning("Status update for unknown command: {CommandId}", commandId);
            return;
        }

        // Security: ensure the command belongs to the node bound to this connection.
        if (command.NodeId != registeredNodeId)
        {
            _logger.LogWarning(
                "Rejected command status update {CommandId}: command belongs to node {CommandNodeId} but connection is bound to {RegisteredNodeId}",
                commandId,
                command.NodeId,
                registeredNodeId);
            throw new HubException("Unauthorized: command does not belong to this agent.");
        }

        // Parse status string to enum
        if (Enum.TryParse<CommandStatus>(status, true, out var parsedStatus))
        {
            command.Status = parsedStatus;
        }
        else
        {
            _logger.LogWarning("Unknown command status: {Status}", status);
            return;
        }

        // For enhancements: keep ScriptRuns table in sync with command lifecycle and persist bounded output tails.
        if (command.CommandType == CommandType.ScriptRun)
        {
            await TryUpdateScriptRunFromCommandAsync(dbContext, command, parsedStatus, logs).ConfigureAwait(false);
        }

        // Bound inbound log chunk size to protect hub and DB.
        if (!string.IsNullOrEmpty(logs) && logs.Length > MaxCommandLogChunkChars)
        {
            logs = logs[..MaxCommandLogChunkChars] + "\n[...log chunk truncated by server...]\n";
        }

        // Append logs (bounded tail).
        if (!string.IsNullOrEmpty(logs))
        {
            command.OutputLog = string.IsNullOrEmpty(command.OutputLog)
                ? logs
                : command.OutputLog + "\n" + logs;

            command.OutputLog = ManLab.Server.Services.Persistence.TextBounds.TruncateTailUtf8(command.OutputLog, MaxCommandOutputLogBytesUtf8);
        }

        // Set executed time for terminal states
        if (parsedStatus is CommandStatus.Success or CommandStatus.Failed)
        {
            command.ExecutedAt = DateTime.UtcNow;
        }

        await dbContext.SaveChangesAsync();

        // Optional real-time output streaming for dashboards.
        // Dashboards can opt-in by subscribing to a command output group.
        if (!string.IsNullOrEmpty(logs))
        {
            await Clients.Group(GetCommandOutputGroup(commandId))
                .SendAsync("CommandOutputAppended", command.NodeId, command.Id, command.Status.ToString(), logs);
        }

        // Notify connected dashboard clients that commands for this node changed.
        await Clients.All.SendAsync("CommandUpdated", command.NodeId, command.Id, command.Status.ToString());
    }

    private static async Task TryUpdateScriptRunFromCommandAsync(DataContext dbContext, CommandQueueItem command, CommandStatus parsedStatus, string? logs)
    {
        // Command payload should include runId.
        var runId = TryExtractGuidFromPayload(command.Payload, "runId");
        if (runId == Guid.Empty)
        {
            return;
        }

        var run = await dbContext.ScriptRuns.FirstOrDefaultAsync(r => r.Id == runId).ConfigureAwait(false);
        if (run is null)
        {
            return;
        }

        // Defense-in-depth: ensure the run belongs to this command's node.
        if (run.NodeId != command.NodeId)
        {
            return;
        }

        var now = DateTime.UtcNow;

        // Lifecycle mapping.
        run.Status = parsedStatus switch
        {
            CommandStatus.Sent => ScriptRunStatus.Sent,
            CommandStatus.InProgress => ScriptRunStatus.InProgress,
            CommandStatus.Success => ScriptRunStatus.Success,
            CommandStatus.Failed => ScriptRunStatus.Failed,
            _ => run.Status
        };

        if (parsedStatus == CommandStatus.InProgress && run.StartedAt is null)
        {
            run.StartedAt = now;
        }

        if (parsedStatus is CommandStatus.Success or CommandStatus.Failed)
        {
            run.FinishedAt ??= now;
        }

        if (string.IsNullOrWhiteSpace(logs))
        {
            return;
        }

        // Parse structured output chunks from agent.
        if (TryParseScriptOutputChunk(logs, out var stream, out var chunk))
        {
            if (string.Equals(stream, "stderr", StringComparison.OrdinalIgnoreCase))
            {
                run.StderrTail = AppendTail(run.StderrTail, chunk);
            }
            else
            {
                run.StdoutTail = AppendTail(run.StdoutTail, chunk);
            }

            return;
        }

        // Fallback: treat as stdout-ish.
        run.StdoutTail = AppendTail(run.StdoutTail, logs);
    }

    private static Guid TryExtractGuidFromPayload(string? payloadJson, string propertyName)
    {
        if (string.IsNullOrWhiteSpace(payloadJson))
        {
            return Guid.Empty;
        }

        try
        {
            using var doc = JsonDocument.Parse(payloadJson);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return Guid.Empty;
            }

            if (!root.TryGetProperty(propertyName, out var el))
            {
                return Guid.Empty;
            }

            if (el.ValueKind == JsonValueKind.String && Guid.TryParse(el.GetString(), out var g))
            {
                return g;
            }
        }
        catch
        {
            // Ignore payload parsing errors.
        }

        return Guid.Empty;
    }

    private static bool TryParseScriptOutputChunk(string logs, out string stream, out string chunk)
    {
        stream = "stdout";
        chunk = logs;

        if (string.IsNullOrWhiteSpace(logs))
        {
            return false;
        }

        try
        {
            using var doc = JsonDocument.Parse(logs);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                return false;
            }

            if (!root.TryGetProperty("kind", out var kindEl) || kindEl.ValueKind != JsonValueKind.String)
            {
                return false;
            }

            var kind = kindEl.GetString();
            if (!string.Equals(kind, "script.output", StringComparison.Ordinal))
            {
                return false;
            }

            if (root.TryGetProperty("stream", out var streamEl) && streamEl.ValueKind == JsonValueKind.String)
            {
                stream = streamEl.GetString() ?? "stdout";
            }

            if (root.TryGetProperty("chunk", out var chunkEl) && chunkEl.ValueKind == JsonValueKind.String)
            {
                chunk = chunkEl.GetString() ?? string.Empty;
            }

            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string AppendTail(string? existing, string toAppend)
    {
        if (string.IsNullOrEmpty(toAppend))
        {
            return existing ?? string.Empty;
        }

        if (string.IsNullOrWhiteSpace(existing))
        {
            return toAppend;
        }

        // Avoid unbounded growth (bounded by interceptor), but keep readability.
        return existing + "\n" + toAppend;
    }

    /// <summary>
    /// Allows dashboard clients to subscribe to incremental output chunks for a specific command.
    /// This is useful for streaming outputs like log.tail.
    /// </summary>
    public async Task SubscribeCommandOutput(Guid commandId)
    {
        // Best-effort validation: command must exist.
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();
        var exists = await db.CommandQueue.AsNoTracking().AnyAsync(c => c.Id == commandId);
        if (!exists)
        {
            throw new HubException("Command not found.");
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, GetCommandOutputGroup(commandId));
    }

    public async Task UnsubscribeCommandOutput(Guid commandId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GetCommandOutputGroup(commandId));
    }

    private static string GetCommandOutputGroup(Guid commandId)
        => $"{CommandOutputGroupPrefix}.{commandId:N}";

    private bool TryGetBearerToken(out string token)
    {
        token = string.Empty;
        var httpContext = Context.GetHttpContext();
        var auth = httpContext?.Request.Headers.Authorization.ToString();

        // Prefer Authorization header.
        if (!string.IsNullOrWhiteSpace(auth))
        {
            const string prefix = "Bearer ";
            if (!auth.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return false;
            }

            token = auth[prefix.Length..].Trim();
            return !string.IsNullOrWhiteSpace(token);
        }

        // SignalR clients (especially browsers) often send tokens via the `access_token` query string.
        // Supporting this improves interoperability and allows clients to use AccessTokenProvider.
        var accessToken = httpContext?.Request.Query["access_token"].ToString();
        if (!string.IsNullOrWhiteSpace(accessToken))
        {
            token = accessToken.Trim();
            return !string.IsNullOrWhiteSpace(token);
        }

        return false;
    }

    #region Agent Backoff and Ping Methods

    /// <summary>
    /// Receives backoff status from an agent when heartbeat fails.
    /// Broadcasts to dashboard clients so they can display next expected ping time.
    /// </summary>
    /// <param name="nodeId">The node reporting backoff status.</param>
    /// <param name="consecutiveFailures">Number of consecutive heartbeat failures.</param>
    /// <param name="nextRetryTimeUtc">When the next heartbeat will be attempted.</param>
    public async Task ReportBackoffStatus(Guid nodeId, int consecutiveFailures, DateTime nextRetryTimeUtc)
    {
        _logger.LogInformation(
            "Node {NodeId} backoff status: {Failures} failures, next retry at {NextRetry:O}",
            nodeId, consecutiveFailures, nextRetryTimeUtc);

        // Broadcast to dashboard clients
        await Clients.All.SendAsync("AgentBackoffStatus", nodeId, consecutiveFailures, nextRetryTimeUtc);
    }

    /// <summary>
    /// Receives ping response from an agent after admin-initiated ping.
    /// </summary>
    /// <param name="nodeId">The node responding to ping.</param>
    /// <param name="success">Whether the ping was successful.</param>
    /// <param name="nextRetryTimeUtc">Next retry time if ping failed (null if successful).</param>
    public async Task PingResponse(Guid nodeId, bool success, DateTime? nextRetryTimeUtc)
    {
        _logger.LogInformation(
            "Ping response from node {NodeId}: success={Success}, nextRetry={NextRetry}",
            nodeId, success, nextRetryTimeUtc?.ToString("O") ?? "N/A");

        // Broadcast to dashboard clients
        await Clients.All.SendAsync("AgentPingResponse", nodeId, success, nextRetryTimeUtc);

        if (success)
        {
            // Clear any backoff status in UI
            await Clients.All.SendAsync("AgentBackoffStatus", nodeId, 0, (DateTime?)null);
        }
    }

    #endregion

    #region Server-to-Agent Methods

    /// <summary>
    /// Sends a command to a specific agent for execution.
    /// </summary>
    /// <param name="connectionId">The SignalR connection ID of the target agent.</param>
    /// <param name="commandId">The command ID for tracking.</param>
    /// <param name="type">The type of command to execute.</param>
    /// <param name="payload">JSON payload with command parameters.</param>
    public async Task ExecuteCommandOnAgent(string connectionId, Guid commandId, string type, string payload)
    {
        await Clients.Client(connectionId).SendAsync("ExecuteCommand", commandId, type, payload);
    }

    /// <summary>
    /// Requests an immediate telemetry push from a specific agent.
    /// </summary>
    /// <param name="connectionId">The SignalR connection ID of the target agent.</param>
    public async Task RequestTelemetryFromAgent(string connectionId)
    {
        await Clients.Client(connectionId).SendAsync("RequestTelemetry");
    }

    /// <summary>
    /// Requests a ping from a specific agent (admin-initiated).
    /// </summary>
    /// <param name="connectionId">The SignalR connection ID of the target agent.</param>
    public async Task RequestPingFromAgent(string connectionId)
    {
        await Clients.Client(connectionId).SendAsync("RequestPing");
    }

    #endregion
}
