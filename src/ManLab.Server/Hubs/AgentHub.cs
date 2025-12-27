using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Security;
using ManLab.Server.Services.Agents;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Hubs;

/// <summary>
/// SignalR hub for agent communication.
/// Handles agent registration, telemetry heartbeats, and command status updates.
/// </summary>
public class AgentHub : Hub
{
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
            authedNode.LastSeen = DateTime.UtcNow;
            authedNode.Status = NodeStatus.Online;

            await dbContext.SaveChangesAsync();

            // Bind the latest connectionId to this nodeId for targeted server->agent calls.
            _connectionRegistry.Set(authedNode.Id, Context.ConnectionId);

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

        // Let dashboards upsert immediately without waiting for a REST poll.
        await Clients.All.SendAsync("NodeRegistered", new
        {
            id = newNode.Id,
            hostname = newNode.Hostname,
            ipAddress = newNode.IpAddress,
            os = newNode.OS,
            agentVersion = newNode.AgentVersion,
            lastSeen = newNode.LastSeen,
            status = newNode.Status.ToString(),
            createdAt = newNode.CreatedAt
        });

        await Clients.All.SendAsync("NodeStatusChanged", newNode.Id, newNode.Status.ToString(), newNode.LastSeen);

        return newNode.Id;
    }

    /// <summary>
    /// Receives heartbeat with telemetry data from an agent.
    /// Updates the node's LastSeen timestamp and stores telemetry snapshot.
    /// </summary>
    /// <param name="nodeId">The node ID sending the heartbeat.</param>
    /// <param name="data">Telemetry data from the agent.</param>
    public async Task SendHeartbeat(Guid nodeId, TelemetryData data)
    {
        if (!TryGetBearerToken(out var bearerToken))
        {
            throw new HubException("Unauthorized: missing bearer token.");
        }

        var tokenHash = TokenHasher.NormalizeToSha256Hex(bearerToken);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Update node's LastSeen
        var node = await dbContext.Nodes.FindAsync(nodeId);
        if (node == null)
        {
            _logger.LogWarning("Heartbeat from unknown node: {NodeId}", nodeId);
            return;
        }

        // Security: ensure the caller token matches the node.
        if (!string.Equals(node.AuthKeyHash, tokenHash, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning("Rejected heartbeat for node {NodeId}: auth token mismatch", nodeId);
            throw new HubException("Unauthorized: token does not match node.");
        }

        var previousStatus = node.Status;

        node.LastSeen = DateTime.UtcNow;
        node.Status = NodeStatus.Online;

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
            Timestamp = DateTime.UtcNow,
            CpuUsage = data.CpuPercent,
            RamUsage = ramUsage,
            DiskUsage = diskUsage,
            Temperature = data.CpuTempCelsius
        };

        dbContext.TelemetrySnapshots.Add(snapshot);
        await dbContext.SaveChangesAsync();

        _logger.LogDebug("Heartbeat received from node: {NodeId}", nodeId);

        if (previousStatus != node.Status)
        {
            await Clients.All.SendAsync("NodeStatusChanged", node.Id, node.Status.ToString(), node.LastSeen);
        }

        // Let the dashboard invalidate/refetch telemetry for this node.
        await Clients.All.SendAsync("TelemetryReceived", node.Id);
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
        if (!TryGetBearerToken(out var bearerToken))
        {
            throw new HubException("Unauthorized: missing bearer token.");
        }

        var tokenHash = TokenHasher.NormalizeToSha256Hex(bearerToken);

        _logger.LogInformation("Command status update: {CommandId} -> {Status}", commandId, status);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        var command = await dbContext.CommandQueue.FindAsync(commandId);
        if (command == null)
        {
            _logger.LogWarning("Status update for unknown command: {CommandId}", commandId);
            return;
        }

        // Security: ensure the command belongs to the node authenticated by this token.
        var node = await dbContext.Nodes.FindAsync(command.NodeId);
        if (node is null || !string.Equals(node.AuthKeyHash, tokenHash, StringComparison.OrdinalIgnoreCase))
        {
            _logger.LogWarning("Rejected command status update {CommandId}: auth token mismatch", commandId);
            throw new HubException("Unauthorized: token does not match node.");
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

        // Append logs
        if (!string.IsNullOrEmpty(logs))
        {
            command.OutputLog = string.IsNullOrEmpty(command.OutputLog)
                ? logs
                : command.OutputLog + "\n" + logs;
        }

        // Set executed time for terminal states
        if (parsedStatus is CommandStatus.Success or CommandStatus.Failed)
        {
            command.ExecutedAt = DateTime.UtcNow;
        }

        await dbContext.SaveChangesAsync();

        // Notify connected dashboard clients that commands for this node changed.
        await Clients.All.SendAsync("CommandUpdated", command.NodeId, command.Id, command.Status.ToString());
    }

    private bool TryGetBearerToken(out string token)
    {
        token = string.Empty;
        var httpContext = Context.GetHttpContext();
        var auth = httpContext?.Request.Headers.Authorization.ToString();

        if (string.IsNullOrWhiteSpace(auth))
        {
            return false;
        }

        const string prefix = "Bearer ";
        if (!auth.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        token = auth[prefix.Length..].Trim();
        return !string.IsNullOrWhiteSpace(token);
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
