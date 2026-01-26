using System.Collections.Concurrent;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// Tracks active dashboard SignalR connections.
/// </summary>
public sealed class DashboardConnectionTracker
{
    private readonly ConcurrentDictionary<string, byte> _connections = new();

    public void Register(string connectionId)
        => _connections.TryAdd(connectionId, 0);

    public void Unregister(string connectionId)
        => _connections.TryRemove(connectionId, out _);

    public bool HasDashboards => !_connections.IsEmpty;

    public int Count => _connections.Count;
}
