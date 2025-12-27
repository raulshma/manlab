using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Agents;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Controllers;

/// <summary>
/// REST API controller for managing device nodes.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class DevicesController : ControllerBase
{
    private const int MaxCommandPayloadChars = 32_768;

    private readonly DataContext _dbContext;
    private readonly ILogger<DevicesController> _logger;
    private readonly IHubContext<AgentHub> _hubContext;
    private readonly AgentConnectionRegistry _connectionRegistry;

    public DevicesController(
        DataContext dbContext,
        ILogger<DevicesController> logger,
        IHubContext<AgentHub> hubContext,
        AgentConnectionRegistry connectionRegistry)
    {
        _dbContext = dbContext;
        _logger = logger;
        _hubContext = hubContext;
        _connectionRegistry = connectionRegistry;
    }

    /// <summary>
    /// Gets all registered device nodes.
    /// </summary>
    /// <returns>List of all nodes.</returns>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<NodeDto>>> GetAll()
    {
        var nodes = await _dbContext.Nodes
            .OrderByDescending(n => n.LastSeen)
            .Select(n => new NodeDto
            {
                Id = n.Id,
                Hostname = n.Hostname,
                IpAddress = n.IpAddress,
                OS = n.OS,
                AgentVersion = n.AgentVersion,
                LastSeen = n.LastSeen,
                Status = n.Status.ToString(),
                CreatedAt = n.CreatedAt
            })
            .ToListAsync();

        return Ok(nodes);
    }

    /// <summary>
    /// Gets a specific device node by ID.
    /// </summary>
    /// <param name="id">The node ID.</param>
    /// <returns>The node details or 404 if not found.</returns>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<NodeDto>> GetById(Guid id)
    {
        var node = await _dbContext.Nodes.FindAsync(id);

        if (node == null)
        {
            return NotFound();
        }

        return Ok(new NodeDto
        {
            Id = node.Id,
            Hostname = node.Hostname,
            IpAddress = node.IpAddress,
            OS = node.OS,
            AgentVersion = node.AgentVersion,
            LastSeen = node.LastSeen,
            Status = node.Status.ToString(),
            CreatedAt = node.CreatedAt
        });
    }

    /// <summary>
    /// Gets the latest telemetry for a specific node.
    /// </summary>
    /// <param name="id">The node ID.</param>
    /// <param name="count">Number of telemetry entries to retrieve (default: 10).</param>
    /// <returns>List of recent telemetry snapshots.</returns>
    [HttpGet("{id:guid}/telemetry")]
    public async Task<ActionResult<IEnumerable<TelemetryDto>>> GetTelemetry(Guid id, [FromQuery] int count = 10)
    {
        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var telemetry = await _dbContext.TelemetrySnapshots
            .Where(t => t.NodeId == id)
            .OrderByDescending(t => t.Timestamp)
            .Take(count)
            .Select(t => new TelemetryDto
            {
                Timestamp = t.Timestamp,
                CpuUsage = t.CpuUsage,
                RamUsage = t.RamUsage,
                DiskUsage = t.DiskUsage,
                Temperature = t.Temperature
            })
            .ToListAsync();

        return Ok(telemetry);
    }

    /// <summary>
    /// Gets command history for a specific node.
    /// </summary>
    /// <param name="id">The node ID.</param>
    /// <param name="count">Number of commands to retrieve (default: 20).</param>
    /// <returns>List of recent commands.</returns>
    [HttpGet("{id:guid}/commands")]
    public async Task<ActionResult<IEnumerable<CommandDto>>> GetCommands(Guid id, [FromQuery] int count = 20)
    {
        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var commands = await _dbContext.CommandQueue
            .Where(c => c.NodeId == id)
            .OrderByDescending(c => c.CreatedAt)
            .Take(count)
            .Select(c => new CommandDto
            {
                Id = c.Id,
                CommandType = c.CommandType.ToString(),
                Payload = c.Payload,
                Status = c.Status.ToString(),
                OutputLog = c.OutputLog,
                CreatedAt = c.CreatedAt,
                ExecutedAt = c.ExecutedAt
            })
            .ToListAsync();

        return Ok(commands);
    }

    /// <summary>
    /// Queues a new command for a specific node.
    /// </summary>
    /// <param name="id">The node ID.</param>
    /// <param name="request">The command request.</param>
    /// <returns>The created command.</returns>
    [HttpPost("{id:guid}/commands")]
    public async Task<ActionResult<CommandDto>> CreateCommand(Guid id, [FromBody] CreateCommandRequest request)
    {
        var node = await _dbContext.Nodes.FindAsync(id);
        if (node == null)
        {
            return NotFound();
        }

        // Parse command type
        if (!Enum.TryParse<CommandType>(request.CommandType, true, out var commandType))
        {
            return BadRequest($"Invalid command type: {request.CommandType}");
        }

        // Security hardening: payload must be strict JSON if provided, and match basic schema.
        var payload = request.Payload;
        if (!string.IsNullOrWhiteSpace(payload))
        {
            if (payload.Length > MaxCommandPayloadChars)
            {
                return BadRequest($"Payload too large (max {MaxCommandPayloadChars} characters).");
            }

            JsonDocument doc;
            try
            {
                doc = JsonDocument.Parse(payload);
            }
            catch (JsonException)
            {
                return BadRequest("Payload must be valid JSON.");
            }
            using (doc)
            {
                // Minimal per-command validation. (Detailed validation belongs in a dedicated command subsystem.)
                if (commandType is CommandType.DockerRestart)
                {
                    if (doc.RootElement.ValueKind != JsonValueKind.Object)
                        return BadRequest("Payload must be a JSON object.");

                    if (!doc.RootElement.TryGetProperty("containerId", out var containerIdEl) &&
                        !doc.RootElement.TryGetProperty("ContainerId", out containerIdEl))
                    {
                        return BadRequest("Payload must include 'containerId'.");
                    }

                    var containerId = containerIdEl.GetString()?.Trim();
                    if (string.IsNullOrWhiteSpace(containerId))
                        return BadRequest("Payload must include a non-empty 'containerId'.");
                }

                if (commandType is CommandType.Shell)
                {
                    if (doc.RootElement.ValueKind != JsonValueKind.Object)
                        return BadRequest("Payload must be a JSON object.");

                    if (!doc.RootElement.TryGetProperty("command", out var commandEl) &&
                        !doc.RootElement.TryGetProperty("Command", out commandEl))
                    {
                        return BadRequest("Payload must include 'command'.");
                    }

                    var shellCommand = commandEl.GetString();
                    if (string.IsNullOrWhiteSpace(shellCommand))
                        return BadRequest("Payload must include a non-empty 'command'.");
                }
            }
        }

        var command = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = id,
            CommandType = commandType,
            Payload = payload,
            Status = Data.Enums.CommandStatus.Queued,
            CreatedAt = DateTime.UtcNow
        };

        _dbContext.CommandQueue.Add(command);
        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Command queued: {CommandId} for node {NodeId}, type: {CommandType}", 
            command.Id, id, commandType);

        return CreatedAtAction(nameof(GetCommands), new { id }, new CommandDto
        {
            Id = command.Id,
            CommandType = command.CommandType.ToString(),
            Payload = command.Payload,
            Status = command.Status.ToString(),
            OutputLog = command.OutputLog,
            CreatedAt = command.CreatedAt,
            ExecutedAt = command.ExecutedAt
        });
    }

    /// <summary>
    /// Deletes a specific device node by ID.
    /// If the agent is connected, sends an uninstall command to cleanup the agent.
    /// Also removes all associated telemetry snapshots and commands.
    /// </summary>
    /// <param name="id">The node ID.</param>
    /// <returns>No content if deleted, 404 if not found.</returns>
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> Delete(Guid id)
    {
        var node = await _dbContext.Nodes
            .Include(n => n.TelemetrySnapshots)
            .Include(n => n.Commands)
            .FirstOrDefaultAsync(n => n.Id == id);

        if (node == null)
        {
            return NotFound();
        }

        // If agent is connected, send uninstall command to cleanup the agent
        if (_connectionRegistry.TryGet(id, out var connectionId))
        {
            _logger.LogInformation("Sending uninstall command to connected agent for node {NodeId}", id);
            
            // Queue the uninstall command
            var uninstallCommand = new Data.Entities.CommandQueueItem
            {
                Id = Guid.NewGuid(),
                NodeId = id,
                CommandType = Data.Enums.CommandType.Uninstall,
                Status = Data.Enums.CommandStatus.Queued,
                CreatedAt = DateTime.UtcNow
            };
            _dbContext.CommandQueue.Add(uninstallCommand);
            await _dbContext.SaveChangesAsync();

            // Send directly to the agent (don't wait for dispatch service)
            await _hubContext.Clients.Client(connectionId)
                .SendAsync("ExecuteCommand", uninstallCommand.Id, "agent.uninstall", string.Empty);
        }

        _dbContext.Nodes.Remove(node);
        await _dbContext.SaveChangesAsync();

        _logger.LogInformation("Deleted node: {NodeId} ({Hostname})", id, node.Hostname);

        return NoContent();
    }

    /// <summary>
    /// Requests an immediate ping from a specific agent.
    /// If the ping succeeds, the agent's heartbeat backoff will be reset.
    /// </summary>
    /// <param name="id">The node ID.</param>
    /// <returns>
    /// 202 Accepted if the ping request was sent,
    /// 404 if the node doesn't exist,
    /// 503 if the agent is not currently connected.
    /// </returns>
    [HttpPost("{id:guid}/ping")]
    public async Task<IActionResult> RequestPing(Guid id)
    {
        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        if (!_connectionRegistry.TryGet(id, out var connectionId))
        {
            _logger.LogWarning("Cannot request ping for node {NodeId}: agent not connected", id);
            return StatusCode(503, new { message = "Agent is not currently connected" });
        }

        await _hubContext.Clients.Client(connectionId).SendAsync("RequestPing");

        _logger.LogInformation("Admin ping request sent to node {NodeId}", id);

        return Accepted(new { message = "Ping request sent to agent" });
    }
}

/// <summary>
/// DTO for node information returned by the API.
/// </summary>
public record NodeDto
{
    public Guid Id { get; init; }
    public string Hostname { get; init; } = string.Empty;
    public string? IpAddress { get; init; }
    public string? OS { get; init; }
    public string? AgentVersion { get; init; }
    public DateTime LastSeen { get; init; }
    public string Status { get; init; } = string.Empty;
    public DateTime CreatedAt { get; init; }
}

/// <summary>
/// DTO for telemetry information returned by the API.
/// </summary>
public record TelemetryDto
{
    public DateTime Timestamp { get; init; }
    public float CpuUsage { get; init; }
    public float RamUsage { get; init; }
    public float DiskUsage { get; init; }
    public float? Temperature { get; init; }
}

/// <summary>
/// DTO for command information returned by the API.
/// </summary>
public record CommandDto
{
    public Guid Id { get; init; }
    public string CommandType { get; init; } = string.Empty;
    public string? Payload { get; init; }
    public string Status { get; init; } = string.Empty;
    public string? OutputLog { get; init; }
    public DateTime CreatedAt { get; init; }
    public DateTime? ExecutedAt { get; init; }
}

/// <summary>
/// Request DTO for creating a new command.
/// </summary>
public record CreateCommandRequest
{
    public string CommandType { get; init; } = string.Empty;
    public string? Payload { get; init; }
}
