using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
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

    public AgentHub(ILogger<AgentHub> logger, IServiceScopeFactory scopeFactory)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
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
        _logger.LogInformation("Agent registering: {Hostname}", metadata.Hostname);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Check if node already exists by hostname
        var existingNode = await dbContext.Nodes
            .FirstOrDefaultAsync(n => n.Hostname == metadata.Hostname);

        if (existingNode != null)
        {
            var previousStatus = existingNode.Status;

            // Update existing node
            existingNode.IpAddress = metadata.IpAddress;
            existingNode.OS = metadata.OS;
            existingNode.AgentVersion = metadata.AgentVersion;
            existingNode.LastSeen = DateTime.UtcNow;
            existingNode.Status = NodeStatus.Online;

            await dbContext.SaveChangesAsync();
            _logger.LogInformation("Updated existing node: {NodeId} ({Hostname})", existingNode.Id, metadata.Hostname);

            if (previousStatus != existingNode.Status)
            {
                await Clients.All.SendAsync("NodeStatusChanged", existingNode.Id, existingNode.Status.ToString(), existingNode.LastSeen);
            }

            return existingNode.Id;
        }

        // Create new node
        var newNode = new Node
        {
            Id = Guid.NewGuid(),
            Hostname = metadata.Hostname,
            IpAddress = metadata.IpAddress,
            OS = metadata.OS,
            AgentVersion = metadata.AgentVersion,
            LastSeen = DateTime.UtcNow,
            Status = NodeStatus.Online,
            CreatedAt = DateTime.UtcNow
        };

        dbContext.Nodes.Add(newNode);
        await dbContext.SaveChangesAsync();

        _logger.LogInformation("Registered new node: {NodeId} ({Hostname})", newNode.Id, metadata.Hostname);

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
        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Update node's LastSeen
        var node = await dbContext.Nodes.FindAsync(nodeId);
        if (node == null)
        {
            _logger.LogWarning("Heartbeat from unknown node: {NodeId}", nodeId);
            return;
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
        _logger.LogInformation("Command status update: {CommandId} -> {Status}", commandId, status);

        using var scope = _scopeFactory.CreateScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<DataContext>();

        var command = await dbContext.CommandQueue.FindAsync(commandId);
        if (command == null)
        {
            _logger.LogWarning("Status update for unknown command: {CommandId}", commandId);
            return;
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
    }

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

    #endregion
}
