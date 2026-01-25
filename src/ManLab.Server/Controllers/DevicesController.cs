using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services;
using ManLab.Server.Services.Agents;
using ManLab.Server.Services.Commands;
using ManLab.Server.Services.Audit;
using ManLab.Shared.Dtos;
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
    private readonly IWakeOnLanService _wakeOnLanService;
    private readonly IAuditLog _audit;

    public DevicesController(
        DataContext dbContext,
        ILogger<DevicesController> logger,
        IHubContext<AgentHub> hubContext,
        AgentConnectionRegistry connectionRegistry,
        IWakeOnLanService wakeOnLanService,
        IAuditLog audit)
    {
        _dbContext = dbContext;
        _logger = logger;
        _hubContext = hubContext;
        _connectionRegistry = connectionRegistry;
        _wakeOnLanService = wakeOnLanService;
        _audit = audit;
    }

    /// <summary>
    /// Gets all registered device nodes.
    /// </summary>
    /// <returns>List of all nodes.</returns>
    [HttpGet]
    public async Task<ActionResult<IEnumerable<NodeDto>>> GetAll()
    {
        var nodes = await _dbContext.Nodes
            .AsNoTracking()
            .OrderByDescending(n => n.LastSeen)
            .Select(n => new NodeDto
            {
                Id = n.Id,
                Hostname = n.Hostname,
                IpAddress = n.IpAddress,
                OS = n.OS,
                AgentVersion = n.AgentVersion,
                MacAddress = n.MacAddress,
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
        var node = await _dbContext.Nodes
            .AsNoTracking()
            .FirstOrDefaultAsync(n => n.Id == id);

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
            MacAddress = node.MacAddress,
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
    [ResponseCache(Duration = 5, VaryByQueryKeys = ["count"])]
    public async Task<ActionResult<IEnumerable<TelemetryDto>>> GetTelemetry(Guid id, [FromQuery] int count = 10)
    {
        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var telemetry = await _dbContext.TelemetrySnapshots
            .AsNoTracking()
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
    /// Gets network throughput history for a specific node.
    /// </summary>
    [HttpGet("{id:guid}/telemetry/network")]
    [ResponseCache(Duration = 5, VaryByQueryKeys = ["count"])]
    public async Task<ActionResult<IEnumerable<NetworkTelemetryDto>>> GetNetworkTelemetry(Guid id, [FromQuery] int count = 120)
    {
        if (count <= 0) count = 120;
        count = Math.Min(count, 2_000);

        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _dbContext.TelemetrySnapshots
            .AsNoTracking()
            .Where(t => t.NodeId == id)
            .OrderByDescending(t => t.Timestamp)
            .Take(count)
            .Select(t => new NetworkTelemetryDto
            {
                Timestamp = t.Timestamp,
                NetRxBytesPerSec = t.NetRxBytesPerSec,
                NetTxBytesPerSec = t.NetTxBytesPerSec
            })
            .ToListAsync();

        return Ok(items);
    }

    /// <summary>
    /// Gets ping history for a specific node.
    /// </summary>
    [HttpGet("{id:guid}/telemetry/ping")]
    [ResponseCache(Duration = 5, VaryByQueryKeys = ["count"])]
    public async Task<ActionResult<IEnumerable<PingTelemetryDto>>> GetPingTelemetry(Guid id, [FromQuery] int count = 120)
    {
        if (count <= 0) count = 120;
        count = Math.Min(count, 2_000);

        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _dbContext.TelemetrySnapshots
            .AsNoTracking()
            .Where(t => t.NodeId == id)
            .OrderByDescending(t => t.Timestamp)
            .Take(count)
            .Select(t => new PingTelemetryDto
            {
                Timestamp = t.Timestamp,
                PingTarget = t.PingTarget,
                PingRttMs = t.PingRttMs,
                PingPacketLossPercent = t.PingPacketLossPercent
            })
            .ToListAsync();

        return Ok(items);
    }

    /// <summary>
    /// Gets telemetry history for a specific node over a time range with rollups.
    /// </summary>
    [HttpGet("{id:guid}/telemetry/history")]
    [ResponseCache(Duration = 5, VaryByQueryKeys = ["fromUtc", "toUtc", "resolution"])]
    public async Task<ActionResult<TelemetryHistoryResponse>> GetTelemetryHistory(
        Guid id,
        [FromQuery] DateTime? fromUtc,
        [FromQuery] DateTime? toUtc,
        [FromQuery] string? resolution = "auto")
    {
        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var now = DateTime.UtcNow;
        var from = NormalizeUtc(fromUtc ?? now.AddHours(-1));
        var to = NormalizeUtc(toUtc ?? now);

        if (to <= from)
        {
            return BadRequest("toUtc must be after fromUtc");
        }

        var span = to - from;
        var desired = (resolution ?? "auto").Trim().ToLowerInvariant();
        var resolved = desired switch
        {
            "raw" => "raw",
            "hour" => "hour",
            "day" => "day",
            _ => span.TotalDays <= 7 ? "raw" : span.TotalDays <= 30 ? "hour" : "day"
        };

        if (resolved == "raw")
        {
            var raw = await _dbContext.TelemetrySnapshots
                .AsNoTracking()
                .Where(t => t.NodeId == id && t.Timestamp >= from && t.Timestamp <= to)
                .OrderBy(t => t.Timestamp)
                .Select(t => new TelemetryHistoryPoint
                {
                    Timestamp = t.Timestamp,
                    SampleCount = 1,

                    CpuAvg = t.CpuUsage,
                    CpuMin = t.CpuUsage,
                    CpuMax = t.CpuUsage,
                    CpuP95 = t.CpuUsage,

                    RamAvg = t.RamUsage,
                    RamMin = t.RamUsage,
                    RamMax = t.RamUsage,
                    RamP95 = t.RamUsage,

                    DiskAvg = t.DiskUsage,
                    DiskMin = t.DiskUsage,
                    DiskMax = t.DiskUsage,
                    DiskP95 = t.DiskUsage,

                    TempAvg = t.Temperature,
                    TempMin = t.Temperature,
                    TempMax = t.Temperature,
                    TempP95 = t.Temperature,

                    NetRxAvg = t.NetRxBytesPerSec,
                    NetRxMax = t.NetRxBytesPerSec,
                    NetRxP95 = t.NetRxBytesPerSec,

                    NetTxAvg = t.NetTxBytesPerSec,
                    NetTxMax = t.NetTxBytesPerSec,
                    NetTxP95 = t.NetTxBytesPerSec,

                    PingRttAvg = t.PingRttMs,
                    PingRttMax = t.PingRttMs,
                    PingRttP95 = t.PingRttMs,

                    PingLossAvg = t.PingPacketLossPercent,
                    PingLossMax = t.PingPacketLossPercent,
                    PingLossP95 = t.PingPacketLossPercent
                })
                .ToListAsync();

            return Ok(new TelemetryHistoryResponse
            {
                FromUtc = from,
                ToUtc = to,
                Granularity = "raw",
                BucketSeconds = 0,
                Points = raw
            });
        }

        var granularity = resolved == "day"
            ? TelemetryRollupGranularity.Day
            : TelemetryRollupGranularity.Hour;
        var bucketSeconds = resolved == "day" ? 86400 : 3600;

        var rollups = await _dbContext.TelemetryRollups
            .AsNoTracking()
            .Where(r => r.NodeId == id && r.Granularity == granularity && r.BucketStartUtc >= from && r.BucketStartUtc <= to)
            .OrderBy(r => r.BucketStartUtc)
            .Select(r => new TelemetryHistoryPoint
            {
                Timestamp = r.BucketStartUtc,
                SampleCount = r.SampleCount,
                CpuAvg = r.CpuAvg,
                CpuMin = r.CpuMin,
                CpuMax = r.CpuMax,
                CpuP95 = r.CpuP95,
                RamAvg = r.RamAvg,
                RamMin = r.RamMin,
                RamMax = r.RamMax,
                RamP95 = r.RamP95,
                DiskAvg = r.DiskAvg,
                DiskMin = r.DiskMin,
                DiskMax = r.DiskMax,
                DiskP95 = r.DiskP95,
                TempAvg = r.TempAvg,
                TempMin = r.TempMin,
                TempMax = r.TempMax,
                TempP95 = r.TempP95,
                NetRxAvg = r.NetRxAvg,
                NetRxMax = r.NetRxMax,
                NetRxP95 = r.NetRxP95,
                NetTxAvg = r.NetTxAvg,
                NetTxMax = r.NetTxMax,
                NetTxP95 = r.NetTxP95,
                PingRttAvg = r.PingRttAvg,
                PingRttMax = r.PingRttMax,
                PingRttP95 = r.PingRttP95,
                PingLossAvg = r.PingLossAvg,
                PingLossMax = r.PingLossMax,
                PingLossP95 = r.PingLossP95
            })
            .ToListAsync();

        return Ok(new TelemetryHistoryResponse
        {
            FromUtc = from,
            ToUtc = to,
            Granularity = resolved,
            BucketSeconds = bucketSeconds,
            Points = rollups
        });
    }

    /// <summary>
    /// Gets the latest top-process telemetry for a node (if available).
    /// </summary>
    [HttpGet("{id:guid}/telemetry/processes")]
    [ResponseCache(Duration = 5)]
    public async Task<ActionResult<IEnumerable<ProcessTelemetry>>> GetProcessTelemetry(Guid id)
    {
        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var latest = await _dbContext.TelemetrySnapshots
            .AsNoTracking()
            .Where(t => t.NodeId == id && t.ProcessTelemetryJson != null)
            .OrderByDescending(t => t.Timestamp)
            .Select(t => t.ProcessTelemetryJson)
            .FirstOrDefaultAsync();

        if (latest is null)
        {
            return NotFound();
        }

        try
        {
            var items = JsonSerializer.Deserialize<List<ProcessTelemetry>>(latest);
            return Ok(items ?? []);
        }
        catch
        {
            return NotFound();
        }
    }

    /// <summary>
    /// Gets service status snapshot history for a specific node.
    /// </summary>
    [HttpGet("{id:guid}/service-status")]
    public async Task<ActionResult<IEnumerable<ServiceStatusSnapshotDto>>> GetServiceStatusHistory(Guid id, [FromQuery] int count = 200)
    {
        if (count <= 0) count = 200;
        count = Math.Min(count, 5_000);

        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _dbContext.ServiceStatusSnapshots
            .AsNoTracking()
            .Where(s => s.NodeId == id)
            .OrderByDescending(s => s.Timestamp)
            .ThenBy(s => s.ServiceName)
            .Take(count)
            .Select(s => new ServiceStatusSnapshotDto
            {
                Timestamp = s.Timestamp,
                ServiceName = s.ServiceName,
                State = s.State.ToString(),
                Detail = s.Detail
            })
            .ToListAsync();

        return Ok(items);
    }

    /// <summary>
    /// Gets SMART drive snapshot history for a specific node.
    /// </summary>
    [HttpGet("{id:guid}/telemetry/smart")]
    public async Task<ActionResult<IEnumerable<SmartDriveSnapshotDto>>> GetSmartHistory(Guid id, [FromQuery] int count = 200)
    {
        if (count <= 0) count = 200;
        count = Math.Min(count, 5_000);

        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _dbContext.SmartDriveSnapshots
            .AsNoTracking()
            .Where(s => s.NodeId == id)
            .OrderByDescending(s => s.Timestamp)
            .ThenBy(s => s.Device)
            .Take(count)
            .Select(s => new SmartDriveSnapshotDto
            {
                Timestamp = s.Timestamp,
                Device = s.Device,
                Health = s.Health.ToString(),
                TemperatureC = s.TemperatureC,
                PowerOnHours = s.PowerOnHours
            })
            .ToListAsync();

        return Ok(items);
    }

    /// <summary>
    /// Gets GPU snapshot history for a specific node.
    /// </summary>
    [HttpGet("{id:guid}/telemetry/gpus")]
    public async Task<ActionResult<IEnumerable<GpuSnapshotDto>>> GetGpuHistory(Guid id, [FromQuery] int count = 500)
    {
        if (count <= 0) count = 500;
        count = Math.Min(count, 10_000);

        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _dbContext.GpuSnapshots
            .AsNoTracking()
            .Where(g => g.NodeId == id)
            .OrderByDescending(g => g.Timestamp)
            .ThenBy(g => g.GpuIndex)
            .Take(count)
            .Select(g => new GpuSnapshotDto
            {
                Timestamp = g.Timestamp,
                GpuIndex = g.GpuIndex,
                Vendor = g.Vendor.ToString(),
                Name = g.Name,
                UtilizationPercent = g.UtilizationPercent,
                MemoryUsedBytes = g.MemoryUsedBytes,
                MemoryTotalBytes = g.MemoryTotalBytes,
                TemperatureC = g.TemperatureC
            })
            .ToListAsync();

        return Ok(items);
    }

    /// <summary>
    /// Gets UPS snapshot history for a specific node.
    /// </summary>
    [HttpGet("{id:guid}/telemetry/ups")]
    public async Task<ActionResult<IEnumerable<UpsSnapshotDto>>> GetUpsHistory(Guid id, [FromQuery] int count = 500)
    {
        if (count <= 0) count = 500;
        count = Math.Min(count, 10_000);

        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _dbContext.UpsSnapshots
            .AsNoTracking()
            .Where(u => u.NodeId == id)
            .OrderByDescending(u => u.Timestamp)
            .Take(count)
            .Select(u => new UpsSnapshotDto
            {
                Timestamp = u.Timestamp,
                Backend = u.Backend.ToString(),
                BatteryPercent = u.BatteryPercent,
                LoadPercent = u.LoadPercent,
                OnBattery = u.OnBattery,
                EstimatedRuntimeSeconds = u.EstimatedRuntimeSeconds
            })
            .ToListAsync();

        return Ok(items);
    }

    /// <summary>
    /// Gets agent resource usage history for a specific node.
    /// </summary>
    [HttpGet("{id:guid}/telemetry/agent-resources")]
    [ResponseCache(Duration = 5, VaryByQueryKeys = ["count"])]
    public async Task<ActionResult<IEnumerable<AgentResourceUsageDto>>> GetAgentResourceUsage(Guid id, [FromQuery] int count = 120)
    {
        if (count <= 0) count = 120;
        count = Math.Min(count, 2_000);

        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _dbContext.TelemetrySnapshots
            .AsNoTracking()
            .Where(t => t.NodeId == id && t.AgentCpuPercent != null)
            .OrderByDescending(t => t.Timestamp)
            .Take(count)
            .Select(t => new AgentResourceUsageDto
            {
                Timestamp = t.Timestamp,
                CpuPercent = t.AgentCpuPercent,
                MemoryBytes = t.AgentMemoryBytes,
                GcHeapBytes = t.AgentGcHeapBytes,
                ThreadCount = t.AgentThreadCount
            })
            .ToListAsync();

        return Ok(items);
    }

    /// <summary>
    /// Gets enhanced network telemetry for a specific node (latest snapshot).
    /// </summary>
    [HttpGet("{id:guid}/telemetry/enhanced-network")]
    [ResponseCache(Duration = 5)]
    public async Task<ActionResult<NetworkTelemetry>> GetEnhancedNetworkTelemetry(Guid id)
    {
        var node = await _dbContext.Nodes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == id);
        if (node == null)
        {
            return NotFound();
        }

        // Get the latest telemetry snapshot with enhanced network data
        var latest = await _dbContext.TelemetrySnapshots
            .AsNoTracking()
            .Where(t => t.NodeId == id && t.EnhancedNetworkJson != null)
            .OrderByDescending(t => t.Timestamp)
            .FirstOrDefaultAsync();

        if (latest?.EnhancedNetworkJson == null)
        {
            return NotFound();
        }

        try
        {
            var network = System.Text.Json.JsonSerializer.Deserialize<NetworkTelemetry>(latest.EnhancedNetworkJson);
            return Ok(network);
        }
        catch
        {
            return NotFound();
        }
    }

    /// <summary>
    /// Gets enhanced GPU telemetry for a specific node (latest snapshot).
    /// </summary>
    [HttpGet("{id:guid}/telemetry/enhanced-gpu")]
    [ResponseCache(Duration = 5)]
    public async Task<ActionResult<List<EnhancedGpuTelemetry>>> GetEnhancedGpuTelemetry(Guid id)
    {
        var node = await _dbContext.Nodes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == id);
        if (node == null)
        {
            return NotFound();
        }

        // Get the latest telemetry snapshot with enhanced GPU data
        var latest = await _dbContext.TelemetrySnapshots
            .AsNoTracking()
            .Where(t => t.NodeId == id && t.EnhancedGpuJson != null)
            .OrderByDescending(t => t.Timestamp)
            .FirstOrDefaultAsync();

        if (latest?.EnhancedGpuJson == null)
        {
            return NotFound();
        }

        try
        {
            var gpus = System.Text.Json.JsonSerializer.Deserialize<List<EnhancedGpuTelemetry>>(latest.EnhancedGpuJson);
            return Ok(gpus ?? []);
        }
        catch
        {
            return NotFound();
        }
    }

    /// <summary>
    /// Gets APM telemetry for a specific node (latest snapshot).
    /// </summary>
    [HttpGet("{id:guid}/telemetry/apm")]
    [ResponseCache(Duration = 5)]
    public async Task<ActionResult<ApplicationPerformanceTelemetry>> GetApmTelemetry(Guid id)
    {
        var node = await _dbContext.Nodes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == id);
        if (node == null)
        {
            return NotFound();
        }

        // Get the latest telemetry snapshot with APM data
        var latest = await _dbContext.TelemetrySnapshots
            .AsNoTracking()
            .Where(t => t.NodeId == id && t.ApmJson != null)
            .OrderByDescending(t => t.Timestamp)
            .FirstOrDefaultAsync();

        if (latest?.ApmJson == null)
        {
            return NotFound();
        }

        try
        {
            var apm = System.Text.Json.JsonSerializer.Deserialize<ApplicationPerformanceTelemetry>(latest.ApmJson);
            return Ok(apm);
        }
        catch
        {
            return NotFound();
        }
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
            .AsNoTracking()
            .Where(c => c.NodeId == id)
            .OrderByDescending(c => c.CreatedAt)
            .Take(count)
            .Select(c => new CommandDto
            {
                Id = c.Id,
                CommandType = CommandTypeMapper.ToExternal(c.CommandType),
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
    /// Gets per-node settings for a specific node.
    /// </summary>
    [HttpGet("{id:guid}/settings")]
    public async Task<ActionResult<IEnumerable<NodeSettingDto>>> GetNodeSettings(Guid id)
    {
        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        var settings = await _dbContext.NodeSettings
            .AsNoTracking()
            .Where(s => s.NodeId == id)
            .OrderBy(s => s.Category)
            .ThenBy(s => s.Key)
            .Select(s => new NodeSettingDto
            {
                Key = s.Key,
                Value = s.Value,
                Category = s.Category,
                Description = s.Description,
                UpdatedAt = s.UpdatedAt
            })
            .ToListAsync();

        return Ok(settings);
    }

    /// <summary>
    /// Upserts one or more per-node settings.
    /// </summary>
    [HttpPost("{id:guid}/settings")]
    public async Task<IActionResult> UpsertNodeSettings(Guid id, [FromBody] List<UpsertNodeSettingRequest> settings)
    {
        var nodeExists = await _dbContext.Nodes.AnyAsync(n => n.Id == id);
        if (!nodeExists)
        {
            return NotFound();
        }

        if (settings is null || settings.Count == 0)
        {
            return Ok();
        }

        // Simple guardrails.
        if (settings.Count > 100)
        {
            return BadRequest("Too many settings in one request.");
        }

        foreach (var s in settings)
        {
            var key = (s.Key ?? string.Empty).Trim();
            if (string.IsNullOrWhiteSpace(key) || key.Length > 256)
            {
                return BadRequest("Each setting must have a non-empty key (max 256 chars).");
            }

            var category = string.IsNullOrWhiteSpace(s.Category) ? "Agent" : s.Category.Trim();
            if (category.Length > 64)
            {
                return BadRequest("Setting category is too long (max 64 chars).");
            }

            var description = s.Description?.Trim();
            if (description is not null && description.Length > 1024)
            {
                return BadRequest("Setting description is too long (max 1024 chars).");
            }

            var existing = await _dbContext.NodeSettings.FindAsync(id, key);
            if (existing is null)
            {
                _dbContext.NodeSettings.Add(new NodeSetting
                {
                    NodeId = id,
                    Key = key,
                    Value = s.Value,
                    Category = category,
                    Description = description,
                    UpdatedAt = DateTime.UtcNow
                });
            }
            else
            {
                existing.Value = s.Value;
                existing.Category = category;
                existing.Description = description;
                existing.UpdatedAt = DateTime.UtcNow;
            }
        }

        await _dbContext.SaveChangesAsync();
        return Ok();
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

        // Parse command type (canonical wire names preferred; legacy enum names supported)
        if (!CommandTypeMapper.TryParseExternal(request.CommandType, out var commandType))
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

        _logger.CommandQueued(command.Id, id, commandType.ToString());

        _audit.TryEnqueue(AuditEventFactory.CreateHttp(
            kind: "audit",
            eventName: "command.enqueued",
            httpContext: HttpContext,
            success: true,
            statusCode: 201,
            nodeId: id,
            commandId: command.Id,
            category: "commands",
            message: "Command queued",
            dataJson: JsonSerializer.Serialize(new { commandType = CommandTypeMapper.ToExternal(commandType) })));

        return CreatedAtAction(nameof(GetCommands), new { id }, new CommandDto
        {
            Id = command.Id,
            CommandType = CommandTypeMapper.ToExternal(command.CommandType),
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
            _logger.SendingUninstallCommand(id);
            
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
                .SendAsync("ExecuteCommand", uninstallCommand.Id, CommandTypes.AgentUninstall, string.Empty);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "audit",
                eventName: "node.uninstall.enqueued",
                httpContext: HttpContext,
                success: true,
                statusCode: 202,
                nodeId: id,
                commandId: uninstallCommand.Id,
                category: "nodes",
                message: "Uninstall queued for connected agent"));
        }

        // Do NOT delete associated onboarding machines here.
        // Users may want to keep the machine configuration/credentials and optionally uninstall via SSH.
        // Instead, unlink any machines pointing at this node.
        var linkedMachines = await _dbContext.OnboardingMachines
            .Where(m => m.LinkedNodeId == id)
            .ToListAsync();

        if (linkedMachines.Count > 0)
        {
            foreach (var m in linkedMachines)
            {
                m.LinkedNodeId = null;
                m.UpdatedAt = DateTime.UtcNow;
            }
        }

        _dbContext.Nodes.Remove(node);
        await _dbContext.SaveChangesAsync();

        _logger.NodeDeleted(id, node.Hostname);

        _audit.TryEnqueue(AuditEventFactory.CreateHttp(
            kind: "audit",
            eventName: "node.deleted",
            httpContext: HttpContext,
            success: true,
            statusCode: 204,
            nodeId: id,
            category: "nodes",
            message: "Node deleted",
            dataJson: JsonSerializer.Serialize(new { hostname = node.Hostname })));

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
            _logger.PingRequestFailed(id);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "audit",
                eventName: "node.ping.requested",
                httpContext: HttpContext,
                success: false,
                statusCode: 503,
                nodeId: id,
                category: "nodes",
                message: "Ping requested but agent not connected"));
            return StatusCode(503, new { message = "Agent is not currently connected" });
        }

        await _hubContext.Clients.Client(connectionId).SendAsync("RequestPing");

        _logger.PingRequestSent(id);

        _audit.TryEnqueue(AuditEventFactory.CreateHttp(
            kind: "activity",
            eventName: "node.ping.requested",
            httpContext: HttpContext,
            success: true,
            statusCode: 202,
            nodeId: id,
            category: "nodes",
            message: "Ping request sent to agent"));

        return Accepted(new { message = "Ping request sent to agent" });
    }

    /// <summary>
    /// Sends a Wake-on-LAN magic packet to restart an offline node.
    /// </summary>
    /// <param name="id">The node ID.</param>
    /// <returns>
    /// 202 Accepted if the WoL packet was sent,
    /// 404 if the node doesn't exist,
    /// 400 if the node has no MAC address or is already online.
    /// </returns>
    [HttpPost("{id:guid}/wake")]
    public async Task<IActionResult> WakeNode(Guid id)
    {
        var node = await _dbContext.Nodes
            .AsNoTracking()
            .FirstOrDefaultAsync(n => n.Id == id);

        if (node == null)
        {
            return NotFound();
        }

        if (string.IsNullOrWhiteSpace(node.MacAddress))
        {
            _logger.WakeFailedNoMac(id);
            return BadRequest(new { message = "Node does not have a MAC address. The agent must connect at least once to report its MAC address." });
        }

        if (node.Status == NodeStatus.Online)
        {
            _logger.WakeFailedAlreadyOnline(id);
            return BadRequest(new { message = "Node is already online" });
        }

        var success = await _wakeOnLanService.SendWakeAsync(node.MacAddress);
        if (!success)
        {
            _logger.WolPacketFailed(id);

            _audit.TryEnqueue(AuditEventFactory.CreateHttp(
                kind: "audit",
                eventName: "node.wake.sent",
                httpContext: HttpContext,
                success: false,
                statusCode: 500,
                nodeId: id,
                category: "nodes",
                message: "Failed to send Wake-on-LAN packet"));
            return StatusCode(500, new { message = "Failed to send Wake-on-LAN packet" });
        }

        _audit.TryEnqueue(AuditEventFactory.CreateHttp(
            kind: "audit",
            eventName: "node.wake.sent",
            httpContext: HttpContext,
            success: true,
            statusCode: 202,
            nodeId: id,
            category: "nodes",
            message: "Wake-on-LAN packet sent"));

        _logger.WolPacketSent(id, node.MacAddress);

        return Accepted(new { message = "Wake-on-LAN packet sent" });
    }

    private static DateTime NormalizeUtc(DateTime value)
    {
        if (value.Kind == DateTimeKind.Utc)
        {
            return value;
        }

        if (value.Kind == DateTimeKind.Local)
        {
            return value.ToUniversalTime();
        }

        return DateTime.SpecifyKind(value, DateTimeKind.Utc);
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
    public string? MacAddress { get; init; }
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

public record NetworkTelemetryDto
{
    public DateTime Timestamp { get; init; }
    public long? NetRxBytesPerSec { get; init; }
    public long? NetTxBytesPerSec { get; init; }
}

public record PingTelemetryDto
{
    public DateTime Timestamp { get; init; }
    public string? PingTarget { get; init; }
    public float? PingRttMs { get; init; }
    public float? PingPacketLossPercent { get; init; }
}

public record ServiceStatusSnapshotDto
{
    public DateTime Timestamp { get; init; }
    public string ServiceName { get; init; } = string.Empty;
    public string State { get; init; } = string.Empty;
    public string? Detail { get; init; }
}

public record SmartDriveSnapshotDto
{
    public DateTime Timestamp { get; init; }
    public string Device { get; init; } = string.Empty;
    public string Health { get; init; } = string.Empty;
    public float? TemperatureC { get; init; }
    public int? PowerOnHours { get; init; }
}

public record GpuSnapshotDto
{
    public DateTime Timestamp { get; init; }
    public int GpuIndex { get; init; }
    public string Vendor { get; init; } = string.Empty;
    public string? Name { get; init; }
    public float? UtilizationPercent { get; init; }
    public long? MemoryUsedBytes { get; init; }
    public long? MemoryTotalBytes { get; init; }
    public float? TemperatureC { get; init; }
}

public record UpsSnapshotDto
{
    public DateTime Timestamp { get; init; }
    public string Backend { get; init; } = string.Empty;
    public float? BatteryPercent { get; init; }
    public float? LoadPercent { get; init; }
    public bool? OnBattery { get; init; }
    public int? EstimatedRuntimeSeconds { get; init; }
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

public record NodeSettingDto
{
    public string Key { get; init; } = string.Empty;
    public string? Value { get; init; }
    public string Category { get; init; } = string.Empty;
    public string? Description { get; init; }
    public DateTime UpdatedAt { get; init; }
}

public record UpsertNodeSettingRequest
{
    public string Key { get; init; } = string.Empty;
    public string? Value { get; init; }
    public string? Category { get; init; }
    public string? Description { get; init; }
}

/// <summary>
/// DTO for agent resource usage returned by the API.
/// </summary>
public record AgentResourceUsageDto
{
    public DateTime Timestamp { get; init; }
    public float? CpuPercent { get; init; }
    public long? MemoryBytes { get; init; }
    public long? GcHeapBytes { get; init; }
    public int? ThreadCount { get; init; }
}
