using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Security;
using ManLab.Server.Services.Agents;
using ManLab.Server.Services.Enhancements;
using ManLab.Server.Services.Audit;
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
    private const int MaxCommandLogChunkChars = 96 * 1024;
    private const int MaxCommandOutputLogBytesUtf8 = 128 * 1024;

    private const string ContextNodeIdKey = "manlab.nodeId";
    private const string ContextTokenHashKey = "manlab.tokenHash";

    private const string CommandOutputGroupPrefix = "command-output";

    // Throttle zip progress updates to every 2 seconds per download
    private static readonly TimeSpan ZipProgressThrottleInterval = TimeSpan.FromSeconds(2);
    private static readonly System.Collections.Concurrent.ConcurrentDictionary<Guid, DateTime> _lastZipProgressUpdate = new();

    private readonly ILogger<AgentHub> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly AgentConnectionRegistry _connectionRegistry;
    private readonly IAuditLog _audit;
    private readonly DownloadSessionService _downloadSessions;
    private readonly StreamingDownloadService _streamingDownloads;

    public AgentHub(
        ILogger<AgentHub> logger,
        IServiceScopeFactory scopeFactory,
        AgentConnectionRegistry connectionRegistry,
        IAuditLog audit,
        DownloadSessionService downloadSessions,
        StreamingDownloadService streamingDownloads)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _connectionRegistry = connectionRegistry;
        _audit = audit;
        _downloadSessions = downloadSessions;
        _streamingDownloads = streamingDownloads;
    }

    /// <summary>
    /// Called when an agent connects. Logs the connection.
    /// Actual registration happens via the Register method.
    /// </summary>
    public override async Task OnConnectedAsync()
    {
        _logger.AgentConnected(Context.ConnectionId);
        await base.OnConnectedAsync();
    }

    /// <summary>
    /// Called when an agent disconnects.
    /// </summary>
    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        _logger.AgentDisconnected(Context.ConnectionId, exception?.Message ?? "Normal disconnect");

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
            _audit.TryEnqueue(AuditEventFactory.CreateSignalR(
                kind: "audit",
                eventName: "agent.register.denied",
                context: Context,
                hub: nameof(AgentHub),
                hubMethod: nameof(Register),
                success: false,
                category: "agents",
                message: "Missing bearer token",
                error: "MissingToken"));
            throw new HubException("Unauthorized: missing bearer token.");
        }

        var tokenHash = TokenHasher.NormalizeToSha256Hex(bearerToken);

        _logger.AgentRegistering(metadata.Hostname);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Prefer binding by auth token hash (using compiled query for performance).
        var authedNode = await CompiledQueries.GetNodeByAuthKeyHashAsync(dbContext, tokenHash);

        if (authedNode is not null)
        {
            var previousStatus = authedNode.Status;

            authedNode.Hostname = metadata.Hostname;
            authedNode.IpAddress = metadata.IpAddress;
            authedNode.OS = metadata.OS;
            authedNode.AgentVersion = metadata.AgentVersion;
            authedNode.CapabilitiesJson = NormalizeJsonOrNull(metadata.CapabilitiesJson);
            authedNode.PrimaryInterface = NormalizeTrimmedOrNull(metadata.PrimaryInterface, 128);
            authedNode.MacAddress = NormalizeTrimmedOrNull(metadata.MacAddress, 17);
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

            _audit.TryEnqueue(AuditEventFactory.CreateSignalR(
                kind: "activity",
                eventName: "agent.registered",
                context: Context,
                hub: nameof(AgentHub),
                hubMethod: nameof(Register),
                success: true,
                nodeId: authedNode.Id,
                category: "agents",
                message: "Agent re-registered",
                dataJson: JsonSerializer.Serialize(new
                {
                    existing = true,
                    hostname = metadata.Hostname,
                    agentVersion = metadata.AgentVersion
                })));

            return authedNode.Id;
        }

        // If it's an unused enrollment token, bind it to the node we create (using compiled query).
        var enrollment = await CompiledQueries.GetValidEnrollmentTokenAsync(dbContext, tokenHash, DateTime.UtcNow);

        if (enrollment is null)
        {
            _audit.TryEnqueue(AuditEventFactory.CreateSignalR(
                kind: "audit",
                eventName: "agent.register.denied",
                context: Context,
                hub: nameof(AgentHub),
                hubMethod: nameof(Register),
                success: false,
                category: "agents",
                message: "Invalid or expired token",
                error: "InvalidOrExpiredToken"));
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
            MacAddress = NormalizeTrimmedOrNull(metadata.MacAddress, 17),
            LastSeen = DateTime.UtcNow,
            Status = NodeStatus.Online,
            AuthKeyHash = tokenHash,
            CreatedAt = DateTime.UtcNow
        };

        dbContext.Nodes.Add(newNode);

        enrollment.UsedAt = DateTime.UtcNow;
        enrollment.NodeId = newNode.Id;

        await dbContext.SaveChangesAsync();

        _logger.NodeRegistered(newNode.Id, metadata.Hostname);

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

        _audit.TryEnqueue(AuditEventFactory.CreateSignalR(
            kind: "audit",
            eventName: "agent.registered",
            context: Context,
            hub: nameof(AgentHub),
            hubMethod: nameof(Register),
            success: true,
            nodeId: newNode.Id,
            category: "agents",
            message: "Agent registered",
            dataJson: JsonSerializer.Serialize(new
            {
                existing = false,
                hostname = metadata.Hostname,
                agentVersion = metadata.AgentVersion
            })));

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
            _logger.HeartbeatRejected(nodeId, registeredNodeId);
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
            PingPacketLossPercent = data.PingPacketLossPercent,

            // Agent process resource usage
            AgentCpuPercent = data.AgentCpuPercent,
            AgentMemoryBytes = data.AgentMemoryBytes,
            AgentGcHeapBytes = data.AgentGcHeapBytes,
            AgentThreadCount = data.AgentThreadCount,

            // Enhanced telemetry (stored as JSON)
            EnhancedNetworkJson = data.Network != null 
                ? System.Text.Json.JsonSerializer.Serialize(data.Network) 
                : null,
            EnhancedGpuJson = data.EnhancedGpus is { Count: > 0 } 
                ? System.Text.Json.JsonSerializer.Serialize(data.EnhancedGpus) 
                : null,
            ApmJson = data.Apm != null 
                ? System.Text.Json.JsonSerializer.Serialize(data.Apm) 
                : null
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

        _logger.HeartbeatReceived(nodeId);

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

        // Verify session belongs to the registered node.
        // IMPORTANT: terminal output can arrive in many small chunks, so avoid a DB query per chunk.
        // Prefer the in-memory session cache and only hit the DB as a fallback.
        await using var scope = _scopeFactory.CreateAsyncScope();

        var sessionService = scope.ServiceProvider.GetRequiredService<TerminalSessionService>();

        Guid sessionNodeId;
        TerminalSessionStatus sessionStatus;

        if (sessionService.TryGet(sessionId, out var cachedSession) && cachedSession is not null)
        {
            sessionNodeId = cachedSession.NodeId;
            // Cache only stores active sessions; treat as open for the isClosed transition below.
            sessionStatus = TerminalSessionStatus.Open;
        }
        else
        {
            var db = scope.ServiceProvider.GetRequiredService<DataContext>();

            var session = await db.TerminalSessions
                .AsNoTracking()
                .Where(s => s.Id == sessionId)
                .Select(s => new { s.NodeId, s.Status })
                .FirstOrDefaultAsync();

            if (session is null)
            {
                _logger.UnknownTerminalSession(sessionId);
                return;
            }

            sessionNodeId = session.NodeId;
            sessionStatus = session.Status;
        }

        if (sessionNodeId != registeredNodeId)
        {
            _logger.LogWarning(
                "Rejected terminal output for session {SessionId}: session belongs to node {SessionNodeId} but connection is bound to {RegisteredNodeId}",
                sessionId, sessionNodeId, registeredNodeId);
            throw new HubException("Unauthorized: session does not belong to this agent.");
        }

        // Update session status if closed
        if (isClosed && sessionStatus == TerminalSessionStatus.Open)
        {
            await sessionService.MarkExpiredAsync(sessionId);
        }

        // Bound the per-message output chunk to reduce memory pressure and avoid oversize broadcasts.
        output ??= string.Empty;
        if (output.Length > MaxTerminalOutputChunkChars)
        {
            output = output[..MaxTerminalOutputChunkChars] + "\n[...output truncated by server...]\n";
        }

        _logger.TerminalOutputReceived(sessionId, output.Length, isClosed);

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
        _logger.TerminalSubscribed(Context.ConnectionId, sessionId);
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

        _logger.CommandStatusUpdate(commandId, status);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        var command = await dbContext.CommandQueue.FindAsync(commandId);
        if (command == null)
        {
            _logger.UnknownCommandStatusUpdate(commandId);
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

        // Append logs (bounded tail) OR overwrite/append for structured-output commands.
        if (!string.IsNullOrEmpty(logs))
        {
            // File browser commands send structured JSON results that may be chunked.
            // IMPORTANT: the agent may send intermediate chunks with status=InProgress and only the final chunk with status=Success.
            // We must treat those chunks as structured; otherwise we'd append with newlines and corrupt JSON.
            //
            // FileZip is excluded here because its InProgress payload is progress telemetry, not the final structured result.
            var isStructuredFileBrowserCommand = command.CommandType is CommandType.FileList or CommandType.FileRead;
            var isTerminalState = parsedStatus is CommandStatus.Success or CommandStatus.Failed;
            var treatAsStructured = ShouldTreatAsStructuredFileBrowserOutput(isStructuredFileBrowserCommand, parsedStatus);

            if (treatAsStructured)
            {
                // For file browser commands, the "logs" payload is actually structured content (JSON).
                // The agent may send large responses in chunks, so we need to accumulate them.
                // Check if this looks like a continuation (doesn't start with '{') or a new JSON response.
                command.OutputLog = AccumulateStructuredOutput(command.OutputLog, logs);
            }
            else
            {
                command.OutputLog = string.IsNullOrEmpty(command.OutputLog)
                    ? logs
                    : command.OutputLog + "\n" + logs;
            }

            command.OutputLog = ManLab.Server.Services.Persistence.TextBounds.TruncateTailUtf8(command.OutputLog, MaxCommandOutputLogBytesUtf8);
        }

        // Set executed time for terminal states
        if (parsedStatus is CommandStatus.Success or CommandStatus.Failed)
        {
            command.ExecutedAt = DateTime.UtcNow;
        }

        // Handle FileZip command completion: update download session TotalBytes
        if (command.CommandType == CommandType.FileZip && parsedStatus == CommandStatus.Success && !string.IsNullOrEmpty(logs))
        {
            await TryUpdateDownloadSessionFromFileZipResultAsync(command.Payload, logs);
        }

        // Handle FileZip in-progress: forward zip creation progress to client
        if (command.CommandType == CommandType.FileZip && parsedStatus == CommandStatus.InProgress && !string.IsNullOrEmpty(logs))
        {
            await TryForwardZipProgressAsync(command.Payload, logs);
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

    internal static bool ShouldTreatAsStructuredFileBrowserOutput(bool isStructuredFileBrowserCommand, CommandStatus status)
    {
        if (!isStructuredFileBrowserCommand)
        {
            return false;
        }

        // Structured chunks may arrive while the command is still InProgress.
        // We treat them as structured to avoid newline insertion corrupting JSON.
        return status is CommandStatus.InProgress or CommandStatus.Success or CommandStatus.Failed;
    }

    internal static string AccumulateStructuredOutput(string? existing, string incomingChunk)
    {
        var looksLikeJsonStart = incomingChunk.TrimStart().StartsWith('{') || incomingChunk.TrimStart().StartsWith('[');

        if (looksLikeJsonStart || string.IsNullOrEmpty(existing))
        {
            // New JSON response - overwrite
            return incomingChunk;
        }

        // Continuation chunk - append to existing
        return existing + incomingChunk;
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

    /// <summary>
    /// Attempts to update download session TotalBytes from FileZipResult.
    /// This enables StreamZipFileAsync to proceed with streaming the zip.
    /// </summary>
    private async Task TryUpdateDownloadSessionFromFileZipResultAsync(string? payloadJson, string logs)
    {
        try
        {
            // Extract downloadId from command payload
            var downloadId = TryExtractGuidFromPayload(payloadJson, "downloadId");
            if (downloadId == Guid.Empty)
            {
                downloadId = TryExtractGuidFromPayload(payloadJson, "DownloadId");
            }

            if (downloadId == Guid.Empty)
            {
                _logger.LogWarning("FileZip command completed but no downloadId found in payload");
                return;
            }

            // Parse FileZipResult from logs to get ArchiveBytes
            using var doc = JsonDocument.Parse(logs);
            var root = doc.RootElement;
            if (root.ValueKind != JsonValueKind.Object)
            {
                _logger.LogWarning("FileZip result is not a JSON object for download {DownloadId}", downloadId);
                return;
            }

            long archiveBytes = 0;
            if (root.TryGetProperty("archiveBytes", out var el) || root.TryGetProperty("ArchiveBytes", out el))
            {
                if (el.ValueKind == JsonValueKind.Number && el.TryGetInt64(out var bytes))
                {
                    archiveBytes = bytes;
                }
            }

            if (archiveBytes <= 0)
            {
                _logger.LogWarning("FileZip result has no valid ArchiveBytes for download {DownloadId}", downloadId);
                return;
            }

            // Extract TempFilePath from result - this is required for streaming the zip
            string? tempFilePath = null;
            if (root.TryGetProperty("tempFilePath", out var pathEl) || root.TryGetProperty("TempFilePath", out pathEl))
            {
                if (pathEl.ValueKind == JsonValueKind.String)
                {
                    tempFilePath = pathEl.GetString();
                }
            }

            if (string.IsNullOrEmpty(tempFilePath))
            {
                _logger.LogWarning(
                    "FileZip result has no TempFilePath for download {DownloadId}. Raw result: {Result}",
                    downloadId, logs.Length > 500 ? logs[..500] + "..." : logs);
                return;
            }

            // Update the download session TotalBytes and TempFilePath so StreamZipFileAsync can proceed
            if (_downloadSessions.SetTotalBytes(downloadId, archiveBytes))
            {
                _logger.LogInformation(
                    "Updated download session {DownloadId} with TotalBytes={ArchiveBytes}",
                    downloadId, archiveBytes);
                
                _downloadSessions.SetTempFilePath(downloadId, tempFilePath);
                _logger.LogInformation(
                    "Updated download session {DownloadId} with TempFilePath={TempFilePath}",
                    downloadId, tempFilePath);

                // Mark the session as Ready so the client knows it can start streaming
                _downloadSessions.UpdateStatus(downloadId, DownloadSessionService.DownloadStatus.Ready);

                // Clean up throttle tracking since zip creation is complete
                _lastZipProgressUpdate.TryRemove(downloadId, out _);

                // Notify client that zip is ready
                if (_downloadSessions.TryGetSession(downloadId, out var session) && session is not null)
                {
                    var statusEvent = new DownloadStatusChangedEvent
                    {
                        DownloadId = downloadId,
                        Status = "ready",
                        Error = null
                    };

                    if (!string.IsNullOrEmpty(session.ClientConnectionId))
                    {
                        await Clients.Client(session.ClientConnectionId).SendAsync(
                            "DownloadStatusChanged",
                            statusEvent.DownloadId.ToString(),
                            statusEvent.Status,
                            statusEvent.Error);
                    }
                    await Clients.Group(GetDownloadProgressGroup(downloadId)).SendAsync(
                        "DownloadStatusChanged",
                        statusEvent.DownloadId.ToString(),
                        statusEvent.Status,
                        statusEvent.Error);
                }
            }
            else
            {
                _logger.LogWarning(
                    "Failed to update download session {DownloadId} - session not found or expired",
                    downloadId);
            }
        }
        catch (JsonException ex)
        {
            _logger.LogWarning(ex, "Failed to parse FileZipResult JSON");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Unexpected error updating download session from FileZipResult");
        }
    }

    /// <summary>
    /// Forwards zip creation progress to the client via SignalR.
    /// Parses progress messages like "Compressing: 50% (5/10 files)" from agent logs.
    /// Throttled to update every 2 seconds for performance.
    /// </summary>
    private async Task TryForwardZipProgressAsync(string? payloadJson, string logs)
    {
        try
        {
            // Extract downloadId from command payload
            var downloadId = TryExtractGuidFromPayload(payloadJson, "downloadId");
            if (downloadId == Guid.Empty)
            {
                downloadId = TryExtractGuidFromPayload(payloadJson, "DownloadId");
            }

            if (downloadId == Guid.Empty)
            {
                return; // Can't forward without downloadId
            }

            // Throttle updates to every 2 seconds per download for performance
            var now = DateTime.UtcNow;
            if (_lastZipProgressUpdate.TryGetValue(downloadId, out var lastUpdate))
            {
                if (now - lastUpdate < ZipProgressThrottleInterval)
                {
                    return; // Skip this update, too soon
                }
            }
            _lastZipProgressUpdate[downloadId] = now;

            // Get the download session to find the client connection
            if (!_downloadSessions.TryGetSession(downloadId, out var session) || session is null)
            {
                _lastZipProgressUpdate.TryRemove(downloadId, out _); // Clean up
                return;
            }

            // Parse progress from logs like "Compressing: 50% (5/10 files)" or "Creating zip archive with 10 file(s)..."
            int? percentComplete = null;

            // Try to extract percentage from "Compressing: XX% (N/M files)"
            var percentMatch = System.Text.RegularExpressions.Regex.Match(logs, @"Compressing:\s*(\d+)%");
            if (percentMatch.Success && int.TryParse(percentMatch.Groups[1].Value, out var percent))
            {
                percentComplete = percent;
            }

            // Send progress update to client using individual parameters
            if (!string.IsNullOrEmpty(session.ClientConnectionId))
            {
                await Clients.Client(session.ClientConnectionId).SendAsync("DownloadProgress", 
                    downloadId.ToString(),
                    0L,                    // bytesTransferred - not applicable during zip creation
                    0L,                    // totalBytes
                    0.0,                   // speedBytesPerSec
                    (int?)null,            // estimatedSecondsRemaining
                    logs,                  // message
                    percentComplete);
            }

            // Also send to the download progress group
            await Clients.Group(GetDownloadProgressGroup(downloadId)).SendAsync("DownloadProgress",
                downloadId.ToString(),
                0L,
                0L,
                0.0,
                (int?)null,
                logs,
                percentComplete);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to forward zip progress");
        }
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
    /// Receives download progress updates from an agent and forwards to the requesting client.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <param name="bytesTransferred">Number of bytes transferred so far.</param>
    /// <param name="totalBytes">Total number of bytes to transfer.</param>
    public async Task ReportDownloadProgress(Guid downloadId, long bytesTransferred, long totalBytes)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before reporting download progress.");
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var downloadService = scope.ServiceProvider.GetRequiredService<DownloadSessionService>();

        if (!downloadService.TryGetSession(downloadId, out var session))
        {
            _logger.LogWarning("Download progress reported for unknown session {DownloadId}", downloadId);
            return;
        }

        // Verify the session belongs to the registered node
        if (session!.NodeId != registeredNodeId)
        {
            _logger.LogWarning(
                "Rejected download progress for session {DownloadId}: session belongs to node {SessionNodeId} but connection is bound to {RegisteredNodeId}",
                downloadId, session.NodeId, registeredNodeId);
            throw new HubException("Unauthorized: download session does not belong to this agent.");
        }

        // Update session progress
        downloadService.UpdateProgress(downloadId, bytesTransferred, totalBytes);

        // Calculate speed and ETA
        var elapsed = DateTime.UtcNow - session.CreatedAt;
        var speedBytesPerSec = elapsed.TotalSeconds > 0 ? bytesTransferred / elapsed.TotalSeconds : 0;
        int? estimatedSecondsRemaining = null;
        if (speedBytesPerSec > 0 && totalBytes > bytesTransferred)
        {
            var remainingBytes = totalBytes - bytesTransferred;
            estimatedSecondsRemaining = (int)Math.Ceiling(remainingBytes / speedBytesPerSec);
        }

        var progressUpdate = new DownloadProgressUpdate
        {
            DownloadId = downloadId,
            BytesTransferred = bytesTransferred,
            TotalBytes = totalBytes,
            SpeedBytesPerSec = speedBytesPerSec,
            EstimatedSecondsRemaining = estimatedSecondsRemaining
        };

        // Forward progress to the requesting client
        if (!string.IsNullOrEmpty(session.ClientConnectionId))
        {
            await Clients.Client(session.ClientConnectionId).SendAsync("DownloadProgress", progressUpdate);
        }

        // Also broadcast to the download progress group for any subscribed clients
        await Clients.Group(GetDownloadProgressGroup(downloadId)).SendAsync("DownloadProgress", progressUpdate);
    }

    /// <summary>
    /// Reports a download status change from the agent.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <param name="status">The new status.</param>
    /// <param name="error">Error message if the download failed.</param>
    public async Task ReportDownloadStatusChanged(Guid downloadId, string status, string? error)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before reporting download status.");
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var downloadService = scope.ServiceProvider.GetRequiredService<DownloadSessionService>();

        if (!downloadService.TryGetSession(downloadId, out var session))
        {
            _logger.LogWarning("Download status change reported for unknown session {DownloadId}", downloadId);
            return;
        }

        // Verify the session belongs to the registered node
        if (session!.NodeId != registeredNodeId)
        {
            _logger.LogWarning(
                "Rejected download status change for session {DownloadId}: session belongs to node {SessionNodeId} but connection is bound to {RegisteredNodeId}",
                downloadId, session.NodeId, registeredNodeId);
            throw new HubException("Unauthorized: download session does not belong to this agent.");
        }

        // Update session status
        if (Enum.TryParse<DownloadSessionService.DownloadStatus>(status, true, out var parsedStatus))
        {
            downloadService.UpdateStatus(downloadId, parsedStatus);

            if (parsedStatus is DownloadSessionService.DownloadStatus.Completed or DownloadSessionService.DownloadStatus.Failed)
            {
                downloadService.CompleteSession(downloadId, parsedStatus == DownloadSessionService.DownloadStatus.Completed, error);
            }
        }

        _logger.LogInformation("Download session {DownloadId} status changed to {Status}", downloadId, status);

        var statusEvent = new DownloadStatusChangedEvent
        {
            DownloadId = downloadId,
            Status = status,
            Error = error
        };

        // Forward status change to the requesting client
        if (!string.IsNullOrEmpty(session.ClientConnectionId))
        {
            await Clients.Client(session.ClientConnectionId).SendAsync("DownloadStatusChanged", statusEvent);
        }

        // Also broadcast to the download progress group
        await Clients.Group(GetDownloadProgressGroup(downloadId)).SendAsync("DownloadStatusChanged", statusEvent);
    }

    /// <summary>
    /// Allows dashboard clients to subscribe to download progress updates.
    /// </summary>
    /// <param name="downloadId">The download session ID to subscribe to.</param>
    public async Task SubscribeDownloadProgress(Guid downloadId)
    {
        await Groups.AddToGroupAsync(Context.ConnectionId, GetDownloadProgressGroup(downloadId));
        _logger.LogDebug("Client {ConnectionId} subscribed to download progress for {DownloadId}", Context.ConnectionId, downloadId);
    }

    /// <summary>
    /// Allows dashboard clients to unsubscribe from download progress updates.
    /// </summary>
    /// <param name="downloadId">The download session ID to unsubscribe from.</param>
    public async Task UnsubscribeDownloadProgress(Guid downloadId)
    {
        await Groups.RemoveFromGroupAsync(Context.ConnectionId, GetDownloadProgressGroup(downloadId));
    }

    private static string GetDownloadProgressGroup(Guid downloadId)
        => $"download-progress.{downloadId:N}";

    /// <summary>
    /// Receives backoff status from an agent when heartbeat fails.
    /// Broadcasts to dashboard clients so they can display next expected ping time.
    /// </summary>
    /// <param name="nodeId">The node reporting backoff status.</param>
    /// <param name="consecutiveFailures">Number of consecutive heartbeat failures.</param>
    /// <param name="nextRetryTimeUtc">When the next heartbeat will be attempted.</param>
    public async Task ReportBackoffStatus(Guid nodeId, int consecutiveFailures, DateTime nextRetryTimeUtc)
    {
        // Verify agent context
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before reporting backoff status.");
        }

        if (registeredNodeId != nodeId)
        {
            _logger.LogWarning(
                "Rejected backoff status for node {NodeId}: connection bound to node {RegisteredNodeId}",
                nodeId, registeredNodeId);
            throw new HubException("Unauthorized: nodeId does not match registered connection.");
        }

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
        // Verify agent context
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before responding to ping.");
        }

        if (registeredNodeId != nodeId)
        {
            _logger.LogWarning(
                "Rejected ping response for node {NodeId}: connection bound to node {RegisteredNodeId}",
                nodeId, registeredNodeId);
            throw new HubException("Unauthorized: nodeId does not match registered connection.");
        }

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

    /// <summary>
    /// Receives error status from an agent when a non-transient error is detected.
    /// </summary>
    /// <param name="nodeId">The node reporting the error.</param>
    /// <param name="errorCode">HTTP status code or other error code (e.g., 401, 403).</param>
    /// <param name="errorMessage">Description of the error.</param>
    public async Task ReportErrorStatus(Guid nodeId, int errorCode, string errorMessage)
    {
        // Verify agent context
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before reporting errors.");
        }

        if (registeredNodeId != nodeId)
        {
            _logger.LogWarning(
                "Rejected error report for node {NodeId}: connection bound to node {RegisteredNodeId}",
                nodeId, registeredNodeId);
            throw new HubException("Unauthorized: nodeId does not match registered connection.");
        }

        _logger.LogWarning(
            "Node {NodeId} reported error: code={ErrorCode}, message={ErrorMessage}",
            nodeId, errorCode, errorMessage);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;

        // Update node with error state
        await dbContext.Nodes
            .Where(n => n.Id == nodeId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(n => n.Status, NodeStatus.Error)
                .SetProperty(n => n.ErrorCode, errorCode)
                .SetProperty(n => n.ErrorMessage, Truncate(errorMessage, 1024))
                .SetProperty(n => n.ErrorAt, now)
                .SetProperty(n => n.LastSeen, now));

        // Broadcast to dashboard clients
        await Clients.All.SendAsync("NodeErrorStateChanged", nodeId, errorCode, errorMessage, now);
        await Clients.All.SendAsync("NodeStatusChanged", nodeId, NodeStatus.Error.ToString(), now);
    }

    /// <summary>
    /// Clears error status for a node. Called when admin resolves the issue.
    /// This is typically called from a REST API endpoint, not by agents.
    /// </summary>
    /// <param name="nodeId">The node to clear error status for.</param>
    public async Task ClearErrorStatus(Guid nodeId)
    {
        _logger.LogInformation("Clearing error status for node {NodeId}", nodeId);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;

        // Clear error state and set to offline (agent will reconnect and come online)
        await dbContext.Nodes
            .Where(n => n.Id == nodeId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(n => n.Status, NodeStatus.Offline)
                .SetProperty(n => n.ErrorCode, (int?)null)
                .SetProperty(n => n.ErrorMessage, (string?)null)
                .SetProperty(n => n.ErrorAt, (DateTime?)null)
                .SetProperty(n => n.LastSeen, now));

        // Broadcast to dashboard clients
        await Clients.All.SendAsync("NodeErrorStateCleared", nodeId);
        await Clients.All.SendAsync("NodeStatusChanged", nodeId, NodeStatus.Offline.ToString(), now);
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

    #region High-Performance Streaming Methods

    /// <summary>
    /// Receives a raw binary chunk for high-performance streaming downloads.
    /// Uses ReadOnlyMemory instead of Base64 for efficiency with large files.
    /// </summary>
    /// <param name="streamId">The streaming session ID.</param>
    /// <param name="chunkData">Raw binary chunk data.</param>
    public async Task StreamChunk(Guid streamId, byte[] chunkData)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before streaming chunks.");
        }

        if (!_streamingDownloads.TryGetDownload(streamId, out var download) || download is null)
        {
            _logger.LogWarning("Chunk received for unknown streaming session {StreamId}", streamId);
            return;
        }

        if (download.NodeId != registeredNodeId)
        {
            throw new HubException("Unauthorized: streaming session does not belong to this agent.");
        }

        var success = await download.WriteChunkAsync(chunkData);
        if (!success)
        {
            _logger.LogWarning("Failed to write chunk to streaming session {StreamId}", streamId);
        }
    }

    /// <summary>
    /// Reports file metadata before streaming starts (enables Content-Length header).
    /// </summary>
    /// <param name="streamId">The streaming session ID.</param>
    /// <param name="totalBytes">Total file size in bytes.</param>
    /// <param name="lastModified">Last modified timestamp (ISO 8601).</param>
    /// <param name="eTag">ETag for cache validation.</param>
    public Task StreamMetadata(Guid streamId, long totalBytes, string? lastModified, string? eTag)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before reporting stream metadata.");
        }

        if (!_streamingDownloads.TryGetDownload(streamId, out var download) || download is null)
        {
            _logger.LogWarning("Metadata received for unknown streaming session {StreamId}", streamId);
            return Task.CompletedTask;
        }

        if (download.NodeId != registeredNodeId)
        {
            throw new HubException("Unauthorized: streaming session does not belong to this agent.");
        }

        download.SetTotalBytes(totalBytes);

        _logger.LogInformation(
            "Stream metadata received for {StreamId}: {TotalBytes} bytes, modified: {LastModified}",
            streamId, totalBytes, lastModified ?? "unknown");

        return Task.CompletedTask;
    }

    /// <summary>
    /// Signals that high-performance streaming is complete.
    /// </summary>
    /// <param name="streamId">The streaming session ID.</param>
    public Task StreamComplete(Guid streamId)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before completing stream.");
        }

        if (!_streamingDownloads.TryGetDownload(streamId, out var download) || download is null)
        {
            _logger.LogWarning("Stream complete received for unknown session {StreamId}", streamId);
            return Task.CompletedTask;
        }

        if (download.NodeId != registeredNodeId)
        {
            throw new HubException("Unauthorized: streaming session does not belong to this agent.");
        }

        download.Complete();

        _logger.LogInformation(
            "High-performance stream completed for {StreamId}, {BytesReceived} bytes received",
            streamId, download.BytesReceived);

        return Task.CompletedTask;
    }

    /// <summary>
    /// Signals that high-performance streaming failed.
    /// </summary>
    /// <param name="streamId">The streaming session ID.</param>
    /// <param name="error">Error message.</param>
    public Task StreamFailed(Guid streamId, string error)
    {
        if (!TryGetRegisteredAgentContext(out var registeredNodeId, out _))
        {
            throw new HubException("Unauthorized: agent must register before reporting stream failure.");
        }

        if (!_streamingDownloads.TryGetDownload(streamId, out var download) || download is null)
        {
            _logger.LogWarning("Stream failed received for unknown session {StreamId}", streamId);
            return Task.CompletedTask;
        }

        if (download.NodeId != registeredNodeId)
        {
            throw new HubException("Unauthorized: streaming session does not belong to this agent.");
        }

        download.Fail(error);

        _logger.LogWarning("High-performance stream failed for {StreamId}: {Error}", streamId, error);

        return Task.CompletedTask;
    }

    #endregion
}
