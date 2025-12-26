using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers;

/// <summary>
/// REST API controller for managing device nodes.
/// </summary>
[ApiController]
[Route("api/[controller]")]
public class DevicesController : ControllerBase
{
    private readonly DataContext _dbContext;
    private readonly ILogger<DevicesController> _logger;

    public DevicesController(DataContext dbContext, ILogger<DevicesController> logger)
    {
        _dbContext = dbContext;
        _logger = logger;
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
        if (!Enum.TryParse<Data.Enums.CommandType>(request.CommandType, true, out var commandType))
        {
            return BadRequest($"Invalid command type: {request.CommandType}");
        }

        var command = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = id,
            CommandType = commandType,
            Payload = request.Payload,
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
