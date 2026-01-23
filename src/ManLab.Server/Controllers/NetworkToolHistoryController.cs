using ManLab.Server.Services.Network;
using Microsoft.AspNetCore.Mvc;

namespace ManLab.Server.Controllers;

/// <summary>
/// REST API for querying and managing network tool execution history.
/// </summary>
[ApiController]
[Route("api/network/history")]
public class NetworkToolHistoryController : ControllerBase
{
    private readonly INetworkToolHistoryService _historyService;
    private readonly ILogger<NetworkToolHistoryController> _logger;

    public NetworkToolHistoryController(
        INetworkToolHistoryService historyService,
        ILogger<NetworkToolHistoryController> logger)
    {
        _historyService = historyService;
        _logger = logger;
    }

    /// <summary>
    /// Gets recent network tool history entries.
    /// </summary>
    /// <param name="count">Maximum number of entries to return (1-500, default 50)</param>
    /// <param name="toolType">Optional filter by tool type</param>
    [HttpGet]
    public async Task<ActionResult<List<NetworkToolHistoryDto>>> GetRecent(
        [FromQuery] int count = 50,
        [FromQuery] string? toolType = null)
    {
        var entries = await _historyService.GetRecentAsync(count, toolType);
        return Ok(entries.Select(MapToDto).ToList());
    }

    /// <summary>
    /// Gets a single history entry by ID.
    /// </summary>
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<NetworkToolHistoryDto>> GetById(Guid id)
    {
        var entry = await _historyService.GetByIdAsync(id);
        if (entry is null)
        {
            return NotFound();
        }
        return Ok(MapToDto(entry));
    }

    /// <summary>
    /// Deletes a single history entry.
    /// </summary>
    [HttpDelete("{id:guid}")]
    public async Task<ActionResult> Delete(Guid id)
    {
        var deleted = await _historyService.DeleteAsync(id);
        if (!deleted)
        {
            return NotFound();
        }
        return NoContent();
    }

    /// <summary>
    /// Deletes entries older than the specified number of days.
    /// </summary>
    [HttpDelete]
    public async Task<ActionResult<DeleteHistoryResult>> DeleteOlderThan([FromQuery] int daysOld = 30)
    {
        if (daysOld < 1)
        {
            return BadRequest("daysOld must be at least 1");
        }

        var cutoff = DateTime.UtcNow.AddDays(-daysOld);
        var deleted = await _historyService.DeleteOlderThanAsync(cutoff);

        _logger.LogInformation("Deleted {Count} network tool history entries older than {Days} days", deleted, daysOld);

        return Ok(new DeleteHistoryResult { DeletedCount = deleted });
    }

    private static NetworkToolHistoryDto MapToDto(Data.Entities.NetworkToolHistoryEntry entry)
    {
        return new NetworkToolHistoryDto
        {
            Id = entry.Id,
            TimestampUtc = entry.TimestampUtc,
            ToolType = entry.ToolType,
            Target = entry.Target,
            InputJson = entry.InputJson,
            ResultJson = entry.ResultJson,
            Success = entry.Success,
            DurationMs = entry.DurationMs,
            ErrorMessage = entry.ErrorMessage
        };
    }
}

/// <summary>
/// DTO for network tool history entries.
/// </summary>
public record NetworkToolHistoryDto
{
    public Guid Id { get; init; }
    public DateTime TimestampUtc { get; init; }
    public string ToolType { get; init; } = string.Empty;
    public string? Target { get; init; }
    public string? InputJson { get; init; }
    public string? ResultJson { get; init; }
    public bool Success { get; init; }
    public int DurationMs { get; init; }
    public string? ErrorMessage { get; init; }
}

/// <summary>
/// Result of bulk delete operation.
/// </summary>
public record DeleteHistoryResult
{
    public int DeletedCount { get; init; }
}
