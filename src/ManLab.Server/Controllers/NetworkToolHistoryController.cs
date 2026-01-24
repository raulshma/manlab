using System.Text;
using System.Text.Json;
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
    /// Gets status metrics for the history writer channel.
    /// </summary>
    [HttpGet("status")]
    public ActionResult<NetworkToolHistoryStatus> GetStatus()
    {
        return Ok(_historyService.GetStatus());
    }

    /// <summary>
    /// Queries network tool history with advanced filtering, sorting, and paging.
    /// </summary>
    [HttpGet("query")]
    public async Task<ActionResult<NetworkToolHistoryQueryDto>> Query([FromQuery] NetworkToolHistoryQueryParams query)
    {
        var parsed = query.ToQuery();
        var result = await _historyService.QueryAsync(parsed);

        return Ok(new NetworkToolHistoryQueryDto
        {
            Items = result.Items.Select(MapToDto).ToList(),
            TotalCount = result.TotalCount,
            Page = result.Page,
            PageSize = result.PageSize
        });
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
    /// Updates tags and notes for a history entry.
    /// </summary>
    [HttpPut("{id:guid}/metadata")]
    public async Task<ActionResult<NetworkToolHistoryDto>> UpdateMetadata(Guid id, [FromBody] UpdateHistoryMetadataRequest request)
    {
        var updated = await _historyService.UpdateMetadataAsync(id, request.Tags, request.Notes);
        if (updated is null)
        {
            return NotFound();
        }

        return Ok(MapToDto(updated));
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

    /// <summary>
    /// Exports history entries matching filters.
    /// </summary>
    [HttpGet("export")]
    public async Task<IActionResult> Export([FromQuery] NetworkToolHistoryQueryParams query, [FromQuery] string format = "csv")
    {
        var parsed = query.ToQuery();
        var entries = await _historyService.GetFilteredAsync(parsed);
        var normalizedFormat = format.Trim().ToLowerInvariant();

        if (normalizedFormat == "json")
        {
            var payload = entries.Select(MapToDto).ToList();
            return Ok(payload);
        }

        var csv = BuildCsv(entries);
        return File(Encoding.UTF8.GetBytes(csv), "text/csv", "network-tool-history.csv");
    }

    private static NetworkToolHistoryDto MapToDto(Data.Entities.NetworkToolHistoryEntry entry)
    {
        List<string> tags = [];
        if (!string.IsNullOrWhiteSpace(entry.TagsJson))
        {
            try
            {
                tags = JsonSerializer.Deserialize<List<string>>(entry.TagsJson) ?? [];
            }
            catch
            {
                // ignore malformed tags
            }
        }

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
            ErrorMessage = entry.ErrorMessage,
            Tags = tags,
            Notes = entry.Notes
        };
    }

    private static string BuildCsv(IEnumerable<Data.Entities.NetworkToolHistoryEntry> entries)
    {
        var sb = new StringBuilder();
        sb.AppendLine("id,timestampUtc,toolType,target,success,durationMs,errorMessage,tags,notes");

        foreach (var entry in entries)
        {
            var tags = entry.TagsJson ?? "";
            sb.AppendLine(string.Join(",", new[]
            {
                EscapeCsv(entry.Id.ToString()),
                EscapeCsv(entry.TimestampUtc.ToString("O")),
                EscapeCsv(entry.ToolType),
                EscapeCsv(entry.Target),
                EscapeCsv(entry.Success.ToString()),
                EscapeCsv(entry.DurationMs.ToString()),
                EscapeCsv(entry.ErrorMessage),
                EscapeCsv(tags),
                EscapeCsv(entry.Notes)
            }));
        }

        return sb.ToString();
    }

    private static string EscapeCsv(string? value)
    {
        if (string.IsNullOrEmpty(value))
        {
            return "";
        }

        var needsQuotes = value.Contains(',') || value.Contains('"') || value.Contains('\n') || value.Contains('\r');
        var escaped = value.Replace("\"", "\"\"");
        return needsQuotes ? $"\"{escaped}\"" : escaped;
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
    public List<string> Tags { get; init; } = [];
    public string? Notes { get; init; }
}

/// <summary>
/// Result of bulk delete operation.
/// </summary>
public record DeleteHistoryResult
{
    public int DeletedCount { get; init; }
}

/// <summary>
/// Query parameters for advanced history filtering.
/// </summary>
public sealed class NetworkToolHistoryQueryParams
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 50;
    public string? ToolTypes { get; init; }
    public string? Status { get; init; }
    public string? Search { get; init; }
    public DateTime? FromUtc { get; init; }
    public DateTime? ToUtc { get; init; }
    public string SortBy { get; init; } = "timestamp";
    public string SortDir { get; init; } = "desc";

    public NetworkToolHistoryQuery ToQuery()
    {
        var toolTypes = ToolTypes?
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .ToList();

        bool? success = Status?.Trim().ToLowerInvariant() switch
        {
            "success" => true,
            "failed" => false,
            _ => null
        };

        return new NetworkToolHistoryQuery
        {
            Page = Page,
            PageSize = PageSize,
            ToolTypes = toolTypes,
            Success = success,
            Search = Search,
            FromUtc = FromUtc,
            ToUtc = ToUtc,
            SortBy = SortBy,
            SortDirection = SortDir
        };
    }
}

/// <summary>
/// Query response payload.
/// </summary>
public sealed record NetworkToolHistoryQueryDto
{
    public List<NetworkToolHistoryDto> Items { get; init; } = [];
    public int TotalCount { get; init; }
    public int Page { get; init; }
    public int PageSize { get; init; }
}

/// <summary>
/// Request payload for updating history metadata.
/// </summary>
public sealed record UpdateHistoryMetadataRequest
{
    public List<string> Tags { get; init; } = [];
    public string? Notes { get; init; }
}
