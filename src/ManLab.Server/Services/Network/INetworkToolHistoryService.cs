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
}
