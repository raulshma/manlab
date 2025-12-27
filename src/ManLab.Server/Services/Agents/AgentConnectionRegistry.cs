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

    public void Set(Guid nodeId, string connectionId)
    {
        _nodeToConnectionId[nodeId] = connectionId;
        _connectionIdToNode[connectionId] = nodeId;
    }

    public bool TryGet(Guid nodeId, out string connectionId)
        => _nodeToConnectionId.TryGetValue(nodeId, out connectionId!);

    /// <summary>
    /// Returns true if there are any connected agents.
    /// </summary>
    public bool HasConnections() => !_nodeToConnectionId.IsEmpty;

    /// <summary>
    /// Gets a point-in-time snapshot of currently connected node IDs.
    /// Useful for composing SQL queries (e.g., IN (...) filters) without holding locks.
    /// </summary>
    public Guid[] GetConnectedNodeIdsSnapshot()
    {
        // ConcurrentDictionary keys enumerations are thread-safe and represent a moment-in-time view.
        return _nodeToConnectionId.Keys.ToArray();
    }

    public bool TryRemoveByConnectionId(string connectionId, out Guid nodeId)
    {
        if (_connectionIdToNode.TryRemove(connectionId, out nodeId))
        {
            _nodeToConnectionId.TryRemove(nodeId, out _);
            return true;
        }

        return false;
    }
}
