using ManLab.Server.Data.Entities;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Service interface for recording and querying network tool execution history.
/// </summary>
public interface INetworkToolHistoryService
{
    /// <summary>
    /// Records a network tool execution asynchronously.
    /// </summary>
    /// <param name="toolType">Type of tool (ping, traceroute, port-scan, etc.)</param>
    /// <param name="target">Primary target of the operation (host, CIDR, etc.)</param>
    /// <param name="input">Input parameters object (will be serialized to JSON)</param>
    /// <param name="result">Result object (will be serialized to JSON)</param>
    /// <param name="success">Whether the operation succeeded</param>
    /// <param name="durationMs">Duration in milliseconds</param>
    /// <param name="error">Error message if failed</param>
    /// <param name="connectionId">Optional SignalR connection ID</param>
    /// <returns>The ID of the recorded entry</returns>
    Task<Guid> RecordAsync(
        string toolType,
        string target,
        object? input,
        object? result,
        bool success,
        int durationMs,
        string? error = null,
        string? connectionId = null);

    /// <summary>
    /// Gets recent history entries.
    /// </summary>
    /// <param name="count">Maximum number of entries to return</param>
    /// <param name="toolType">Optional filter by tool type</param>
    /// <returns>List of history entries</returns>
    Task<List<NetworkToolHistoryEntry>> GetRecentAsync(int count = 50, string? toolType = null);

    /// <summary>
    /// Queries history entries with advanced filtering, sorting, and paging.
    /// </summary>
    Task<NetworkToolHistoryQueryResult> QueryAsync(NetworkToolHistoryQuery query);

    /// <summary>
    /// Gets all history entries matching filters (no paging).
    /// </summary>
    Task<List<NetworkToolHistoryEntry>> GetFilteredAsync(NetworkToolHistoryQuery query);

    /// <summary>
    /// Gets a history entry by ID.
    /// </summary>
    Task<NetworkToolHistoryEntry?> GetByIdAsync(Guid id);

    /// <summary>
    /// Deletes a history entry.
    /// </summary>
    Task<bool> DeleteAsync(Guid id);

    /// <summary>
    /// Deletes entries older than the specified cutoff.
    /// </summary>
    Task<int> DeleteOlderThanAsync(DateTime cutoffUtc);

    /// <summary>
    /// Updates an existing history entry.
    /// </summary>
    Task<bool> UpdateAsync(
        Guid id,
        object? input,
        object? result,
        bool success,
        int durationMs,
        string? error = null,
        string? target = null);

    /// <summary>
    /// Updates tags and notes for an existing history entry.
    /// </summary>
    Task<NetworkToolHistoryEntry?> UpdateMetadataAsync(Guid id, IReadOnlyList<string> tags, string? notes);
}

/// <summary>
/// Query parameters for network tool history.
/// </summary>
public sealed record NetworkToolHistoryQuery
{
    public int Page { get; init; } = 1;
    public int PageSize { get; init; } = 50;
    public IReadOnlyList<string>? ToolTypes { get; init; }
    public bool? Success { get; init; }
    public string? Search { get; init; }
    public DateTime? FromUtc { get; init; }
    public DateTime? ToUtc { get; init; }
    public string SortBy { get; init; } = "timestamp";
    public string SortDirection { get; init; } = "desc";
}

/// <summary>
/// Result payload for paged history query.
/// </summary>
public sealed record NetworkToolHistoryQueryResult(
    IReadOnlyList<NetworkToolHistoryEntry> Items,
    int TotalCount,
    int Page,
    int PageSize
);
