using System.Collections.Concurrent;
using System.Linq;
using System.Threading;

namespace ManLab.Server.Services.Agents;

/// <summary>
/// Tracks the latest SignalR connectionId associated with a nodeId.
/// Used for targeting server-to-agent commands.
/// </summary>
public sealed class AgentConnectionRegistry
{
    private readonly ConcurrentDictionary<Guid, string> _nodeToConnectionId = new();
    private readonly ConcurrentDictionary<string, Guid> _connectionIdToNode = new(StringComparer.Ordinal);
    
    // Cached snapshot with TTL.
    // NOTE: Snapshot caching must be versioned; otherwise a concurrent Clear() can race with
    // snapshot generation and leave a stale non-empty cached array even after the dictionaries are empty.
    private Guid[]? _cachedSnapshot;
    private long _snapshotTimeTicksUtc;
    private long _mutationVersion;
    private long _cachedSnapshotVersion = -1;
    private static readonly TimeSpan SnapshotTtl = TimeSpan.FromSeconds(5);

    public void Set(Guid nodeId, string connectionId)
    {
        _nodeToConnectionId[nodeId] = connectionId;
        _connectionIdToNode[connectionId] = nodeId;

        Interlocked.Increment(ref _mutationVersion);
        
        // Invalidate cache when connection changes
        Volatile.Write(ref _cachedSnapshot, null);
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
        var nowTicks = DateTime.UtcNow.Ticks;
        var currentVersion = Volatile.Read(ref _mutationVersion);

        // Return cached snapshot if still valid and the registry hasn't changed.
        var cached = Volatile.Read(ref _cachedSnapshot);
        if (cached is not null)
        {
            var cachedTicks = Volatile.Read(ref _snapshotTimeTicksUtc);
            var cachedVersion = Volatile.Read(ref _cachedSnapshotVersion);

            if (cachedVersion == currentVersion && (nowTicks - cachedTicks) < SnapshotTtl.Ticks)
            {
                return cached;
            }
        }

        // Create a new snapshot.
        // ConcurrentDictionary key enumeration is thread-safe and represents a moment-in-time view.
        // We only cache if no mutations occurred during snapshot generation.
        var startVersion = currentVersion;
        var snapshot = _nodeToConnectionId.Keys.ToArray();
        var endVersion = Volatile.Read(ref _mutationVersion);

        if (endVersion == startVersion)
        {
            Volatile.Write(ref _cachedSnapshotVersion, endVersion);
            Volatile.Write(ref _snapshotTimeTicksUtc, nowTicks);
            Volatile.Write(ref _cachedSnapshot, snapshot);
        }

        return snapshot;
    }

    public bool TryRemoveByConnectionId(string connectionId, out Guid nodeId)
    {
        if (_connectionIdToNode.TryRemove(connectionId, out nodeId))
        {
            _nodeToConnectionId.TryRemove(nodeId, out _);
            Interlocked.Increment(ref _mutationVersion);
            Volatile.Write(ref _cachedSnapshot, null); // Invalidate cache
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

        Interlocked.Increment(ref _mutationVersion);
        Volatile.Write(ref _cachedSnapshot, null);
        Volatile.Write(ref _cachedSnapshotVersion, -1);
        Volatile.Write(ref _snapshotTimeTicksUtc, 0);
    }
}
