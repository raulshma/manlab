using System.Collections.Concurrent;
using System.Linq;

namespace ManLab.Server.Services.Agents;

/// <summary>
/// Tracks the latest SignalR connectionId associated with a nodeId.
/// Used for targeting server-to-agent commands.
/// </summary>
public sealed class AgentConnectionRegistry
{
    private readonly ConcurrentDictionary<Guid, string> _nodeToConnectionId = new();
    private readonly ConcurrentDictionary<string, Guid> _connectionIdToNode = new(StringComparer.Ordinal);
    
    // Add cached snapshot with TTL
    private Guid[]? _cachedSnapshot;
    private DateTime _snapshotTime;
    private static readonly TimeSpan SnapshotTtl = TimeSpan.FromSeconds(5);

    public void Set(Guid nodeId, string connectionId)
    {
        _nodeToConnectionId[nodeId] = connectionId;
        _connectionIdToNode[connectionId] = nodeId;
        
        // Invalidate cache when connection changes
        _cachedSnapshot = null;
    }

    public bool TryGet(Guid nodeId, out string connectionId)
        => _nodeToConnectionId.TryGetValue(nodeId, out connectionId!);

    /// <summary>
    /// Returns true if there are any connected agents.
    /// </summary>
    public bool HasConnections() => !_nodeToConnectionId.IsEmpty;

    /// <summary>
    /// Gets a point-in-time snapshot of currently connected node IDs.
    /// Uses a 5-second TTL cache to reduce array allocations in hot paths.
    /// Useful for composing SQL queries (e.g., IN (...) filters) without holding locks.
    /// </summary>
    public Guid[] GetConnectedNodeIdsSnapshot()
    {
        var now = DateTime.UtcNow;
        
        // Return cached snapshot if still valid (within last 5 seconds)
        if (_cachedSnapshot != null && now - _snapshotTime < SnapshotTtl)
        {
            return _cachedSnapshot!;
        }
        
        // Create and cache new snapshot
        // ConcurrentDictionary keys enumerations are thread-safe and represent a moment-in-time view.
        _cachedSnapshot = _nodeToConnectionId.Keys.ToArray();
        _snapshotTime = now;
        return _cachedSnapshot!;
    }

    public bool TryRemoveByConnectionId(string connectionId, out Guid nodeId)
    {
        if (_connectionIdToNode.TryRemove(connectionId, out nodeId))
        {
            _nodeToConnectionId.TryRemove(nodeId, out _);
            _cachedSnapshot = null; // Invalidate cache
            return true;
        }

        return false;
    }

    /// <summary>
    /// Resets the registry and clears the cached snapshot.
    /// </summary>
    public void Clear()
    {
        _nodeToConnectionId.Clear();
        _connectionIdToNode.Clear();
        _cachedSnapshot = null;
    }
}
