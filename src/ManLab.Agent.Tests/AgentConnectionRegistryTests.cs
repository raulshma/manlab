using ManLab.Server.Services.Agents;
using Xunit;

namespace ManLab.Agent.Tests;

/// <summary>
/// Comprehensive tests for AgentConnectionRegistry covering:
/// - Initial state and empty registry behavior
/// - Node registration and lookup
/// - Connection ID to node mapping
/// - Snapshot functionality with caching
/// - Cache invalidation on connection changes
/// - Connection removal
/// - Clear and reset operations
/// - Thread safety under concurrent access
/// - Has connections detection
/// </summary>
public class AgentConnectionRegistryTests
{
    private AgentConnectionRegistry CreateRegistry()
    {
        return new AgentConnectionRegistry();
    }

    #region Initial State Tests

    [Fact]
    public void InitialState_HasNoConnections()
    {
        var registry = CreateRegistry();

        Assert.False(registry.HasConnections());
    }

    [Fact]
    public void InitialState_SnapshotReturnsEmptyArray()
    {
        var registry = CreateRegistry();

        var snapshot = registry.GetConnectedNodeIdsSnapshot();

        Assert.NotNull(snapshot);
        Assert.Empty(snapshot);
    }

    [Fact]
    public void InitialState_TryGetReturnsFalse()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();

        var result = registry.TryGet(nodeId, out var connectionId);

        Assert.False(result);
        Assert.Equal(default, connectionId);
    }

    [Fact]
    public void InitialState_TryRemoveByConnectionIdReturnsFalse()
    {
        var registry = CreateRegistry();
        var connectionId = "connection-1";

        var result = registry.TryRemoveByConnectionId(connectionId, out var nodeId);

        Assert.False(result);
        Assert.Equal(default, nodeId);
    }

    #endregion

    #region Node Registration Tests

    [Fact]
    public void Set_NodeRegisteredSuccessfully()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        var connectionId = "connection-1";

        registry.Set(nodeId, connectionId);

        Assert.True(registry.HasConnections());
        Assert.True(registry.TryGet(nodeId, out var retrievedId));
        Assert.Equal(connectionId, retrievedId);
    }

    [Fact]
    public void Set_MultipleNodesRegisteredSuccessfully()
    {
        var registry = CreateRegistry();
        var node1 = Guid.NewGuid();
        var node2 = Guid.NewGuid();
        var node3 = Guid.NewGuid();

        registry.Set(node1, "conn-1");
        registry.Set(node2, "conn-2");
        registry.Set(node3, "conn-3");

        Assert.True(registry.HasConnections());
        Assert.True(registry.TryGet(node1, out _));
        Assert.True(registry.TryGet(node2, out _));
        Assert.True(registry.TryGet(node3, out _));

        var snapshot = registry.GetConnectedNodeIdsSnapshot();
        Assert.Equal(3, snapshot.Length);
        Assert.Contains(node1, snapshot);
        Assert.Contains(node2, snapshot);
        Assert.Contains(node3, snapshot);
    }

    [Fact]
    public void Set_ExistingNodeUpdateOverwritesPreviousConnectionId()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        var oldConnectionId = "conn-old";
        var newConnectionId = "conn-new";

        // Register with old connection
        registry.Set(nodeId, oldConnectionId);
        Assert.True(registry.TryGet(nodeId, out var retrieved));
        Assert.Equal(oldConnectionId, retrieved);

        // Update with new connection
        registry.Set(nodeId, newConnectionId);
        Assert.True(registry.TryGet(nodeId, out retrieved));
        Assert.Equal(newConnectionId, retrieved);
    }

    [Fact]
    public void Set_SameConnectionIdForMultipleNodes()
    {
        var registry = CreateRegistry();
        var node1 = Guid.NewGuid();
        var node2 = Guid.NewGuid();
        var connectionId = "shared-connection";

        registry.Set(node1, connectionId);
        registry.Set(node2, connectionId);

        // Both nodes should be registered
        Assert.True(registry.TryGet(node1, out var conn1));
        Assert.True(registry.TryGet(node2, out var conn2));
        Assert.Equal(connectionId, conn1);
        Assert.Equal(connectionId, conn2);
    }

    [Fact]
    public void Set_DifferentConnectionIdsForSameNodeOverwrites()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        var conn1 = "conn-1";
        var conn2 = "conn-2";
        var conn3 = "conn-3";

        registry.Set(nodeId, conn1);
        registry.Set(nodeId, conn2);
        registry.Set(nodeId, conn3);

        // Should have the last connection ID
        Assert.True(registry.TryGet(nodeId, out var retrieved));
        Assert.Equal(conn3, retrieved);

        // Snapshot should still have only one entry
        var snapshot = registry.GetConnectedNodeIdsSnapshot();
        Assert.Single(snapshot);
        Assert.Contains(nodeId, snapshot);
    }

    #endregion

    #region Snapshot Tests

    [Fact]
    public void GetConnectedNodeIdsSnapshot_ReturnsAllRegisteredNodes()
    {
        var registry = CreateRegistry();
        var nodes = new[]
        {
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid()
        };

        foreach (var node in nodes)
        {
            registry.Set(node, $"conn-{node:N}");
        }

        var snapshot = registry.GetConnectedNodeIdsSnapshot();

        Assert.Equal(nodes.Length, snapshot.Length);
        foreach (var node in nodes)
        {
            Assert.Contains(node, snapshot);
        }
    }

    [Fact]
    public void GetConnectedNodeIdsSnapshot_ReturnsSameCachedInstanceWithinTTL()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        registry.Set(nodeId, "conn-1");

        var snapshot1 = registry.GetConnectedNodeIdsSnapshot();
        var snapshot2 = registry.GetConnectedNodeIdsSnapshot();

        // Within 5 seconds, should return the same cached array
        Assert.Same(snapshot1, snapshot2);
    }

    [Fact]
    public void GetConnectedNodeIdsSnapshot_DifferentCallReturnsCachedArray()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        registry.Set(nodeId, "conn-1");

        var snapshot1 = registry.GetConnectedNodeIdsSnapshot();
        // Small delay but still within TTL
        var snapshot2 = registry.GetConnectedNodeIdsSnapshot();

        // Should be the same reference (same cached array)
        Assert.Same(snapshot1, snapshot2);

        // But both should contain the same data
        Assert.Equal(snapshot1, snapshot2);
        Assert.Equal(snapshot1.Length, snapshot2.Length);
    }

    #endregion

    #region Cache Invalidation Tests

    [Fact]
    public void Set_InvalidatesCachedSnapshot()
    {
        var registry = CreateRegistry();
        var node1 = Guid.NewGuid();

        // Get initial snapshot
        registry.Set(node1, "conn-1");
        var snapshot1 = registry.GetConnectedNodeIdsSnapshot();
        Assert.Single(snapshot1);

        // Add new node (should invalidate cache)
        var node2 = Guid.NewGuid();
        registry.Set(node2, "conn-2");

        var snapshot2 = registry.GetConnectedNodeIdsSnapshot();

        // Should be different array instance
        Assert.NotSame(snapshot1, snapshot2);
        Assert.Equal(2, snapshot2.Length);
        Assert.Contains(node1, snapshot2);
        Assert.Contains(node2, snapshot2);
    }

    [Fact]
    public void TryRemoveByConnectionId_InvalidatesCachedSnapshot()
    {
        var registry = CreateRegistry();
        var node1 = Guid.NewGuid();
        var node2 = Guid.NewGuid();

        registry.Set(node1, "conn-1");
        registry.Set(node2, "conn-2");

        var snapshot1 = registry.GetConnectedNodeIdsSnapshot();
        Assert.Equal(2, snapshot1.Length);

        // Remove one connection (should invalidate cache)
        registry.TryRemoveByConnectionId("conn-1", out _);

        var snapshot2 = registry.GetConnectedNodeIdsSnapshot();

        // Should be different array
        Assert.NotSame(snapshot1, snapshot2);
        Assert.Single(snapshot2);
        Assert.DoesNotContain(node1, snapshot2);
        Assert.Contains(node2, snapshot2);
    }

    [Fact]
    public void Clear_InvalidatesCachedSnapshot()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();

        registry.Set(nodeId, "conn-1");
        var snapshot1 = registry.GetConnectedNodeIdsSnapshot();
        Assert.Single(snapshot1);

        // Clear registry
        registry.Clear();

        var snapshot2 = registry.GetConnectedNodeIdsSnapshot();

        // Should be different instance
        Assert.NotSame(snapshot1, snapshot2);
        Assert.Empty(snapshot2);
        Assert.False(registry.HasConnections());
    }

    #endregion

    #region TryRemoveByConnectionId Tests

    [Fact]
    public void TryRemoveByConnectionId_RemovesNodeSuccessfully()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        var connectionId = "conn-1";

        registry.Set(nodeId, connectionId);

        var result = registry.TryRemoveByConnectionId(connectionId, out var removedNodeId);

        Assert.True(result);
        Assert.Equal(nodeId, removedNodeId);
        Assert.False(registry.TryGet(nodeId, out _));
        Assert.False(registry.HasConnections());
    }

    [Fact]
    public void TryRemoveByConnectionId_ReturnsCorrectNodeId()
    {
        var registry = CreateRegistry();
        var nodes = new[]
        {
            (Guid.NewGuid(), "conn-1"),
            (Guid.NewGuid(), "conn-2"),
            (Guid.NewGuid(), "conn-3")
        };

        foreach (var (nodeId, connId) in nodes)
        {
            registry.Set(nodeId, connId);
        }

        // Remove middle node
        var result = registry.TryRemoveByConnectionId("conn-2", out var removedNodeId);

        Assert.True(result);
        Assert.Equal(nodes[1].Item1, removedNodeId);

        // Verify it's removed
        Assert.False(registry.TryGet(removedNodeId, out _));

        // Other nodes should still be present
        Assert.True(registry.TryGet(nodes[0].Item1, out _));
        Assert.True(registry.TryGet(nodes[2].Item1, out _));
    }

    [Fact]
    public void TryRemoveByConnectionId_NonexistentConnectionReturnsFalse()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        registry.Set(nodeId, "conn-1");

        var result = registry.TryRemoveByConnectionId("nonexistent-conn", out var removedNodeId);

        Assert.False(result);
        Assert.Equal(default, removedNodeId);

        // Original node should still be present
        Assert.True(registry.TryGet(nodeId, out _));
    }

    [Fact]
    public void TryRemoveByConnectionId_RemovesFromBothMappings()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        var connectionId = "conn-1";

        registry.Set(nodeId, connectionId);

        // Verify bidirectional mapping
        Assert.True(registry.TryGet(nodeId, out _));

        // Remove using connection ID
        registry.TryRemoveByConnectionId(connectionId, out _);

        // Node should no longer be accessible via node ID
        Assert.False(registry.TryGet(nodeId, out _));
    }

    #endregion

    #region Clear Tests

    [Fact]
    public void Clear_RemovesAllConnections()
    {
        var registry = CreateRegistry();
        var nodes = new[]
        {
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid(),
            Guid.NewGuid()
        };

        foreach (var node in nodes)
        {
            registry.Set(node, $"conn-{node:N}");
        }

        Assert.Equal(nodes.Length, registry.GetConnectedNodeIdsSnapshot().Length);

        // Clear all
        registry.Clear();

        Assert.False(registry.HasConnections());
        Assert.Empty(registry.GetConnectedNodeIdsSnapshot());

        foreach (var node in nodes)
        {
            Assert.False(registry.TryGet(node, out _));
        }
    }

    [Fact]
    public void Clear_WorksWithEmptyRegistry()
    {
        var registry = CreateRegistry();

        // Should not throw
        registry.Clear();

        Assert.False(registry.HasConnections());
        Assert.Empty(registry.GetConnectedNodeIdsSnapshot());
    }

    [Fact]
    public void Clear_CanRegisterNewNodesAfter()
    {
        var registry = CreateRegistry();
        var node1 = Guid.NewGuid();
        registry.Set(node1, "conn-1");

        registry.Clear();

        var node2 = Guid.NewGuid();
        var node3 = Guid.NewGuid();
        registry.Set(node2, "conn-2");
        registry.Set(node3, "conn-3");

        Assert.True(registry.HasConnections());
        Assert.Equal(2, registry.GetConnectedNodeIdsSnapshot().Length);
        Assert.True(registry.TryGet(node2, out _));
        Assert.True(registry.TryGet(node3, out _));
    }

    #endregion

    #region HasConnections Tests

    [Fact]
    public void HasConnections_ReturnsFalseWhenEmpty()
    {
        var registry = CreateRegistry();
        Assert.False(registry.HasConnections());
    }

    [Fact]
    public void HasConnections_ReturnsTrueWithSingleConnection()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        registry.Set(nodeId, "conn-1");

        Assert.True(registry.HasConnections());
    }

    [Fact]
    public void HasConnections_ReturnsTrueWithMultipleConnections()
    {
        var registry = CreateRegistry();

        for (int i = 0; i < 10; i++)
        {
            registry.Set(Guid.NewGuid(), $"conn-{i}");
        }

        Assert.True(registry.HasConnections());
    }

    [Fact]
    public void HasConnections_ReturnsFalseAfterRemovingAll()
    {
        var registry = CreateRegistry();
        var node1 = Guid.NewGuid();
        var node2 = Guid.NewGuid();

        registry.Set(node1, "conn-1");
        registry.Set(node2, "conn-2");
        Assert.True(registry.HasConnections());

        registry.TryRemoveByConnectionId("conn-1", out _);
        registry.TryRemoveByConnectionId("conn-2", out _);

        Assert.False(registry.HasConnections());
    }

    [Fact]
    public void HasConnections_ReturnsFalseAfterClear()
    {
        var registry = CreateRegistry();
        registry.Set(Guid.NewGuid(), "conn-1");
        registry.Set(Guid.NewGuid(), "conn-2");

        Assert.True(registry.HasConnections());

        registry.Clear();

        Assert.False(registry.HasConnections());
    }

    #endregion

    #region Integration Tests

    [Fact]
    public void FullLifecycle_RegisterModifyRemove()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();

        // Initial state
        Assert.False(registry.HasConnections());

        // Register
        registry.Set(nodeId, "conn-1");
        Assert.True(registry.HasConnections());
        Assert.Single(registry.GetConnectedNodeIdsSnapshot());
        Assert.True(registry.TryGet(nodeId, out var connId));
        Assert.Equal("conn-1", connId);

        // Update connection
        registry.Set(nodeId, "conn-2");
        Assert.True(registry.TryGet(nodeId, out connId));
        Assert.Equal("conn-2", connId);
        Assert.Single(registry.GetConnectedNodeIdsSnapshot());

        // Remove
        registry.TryRemoveByConnectionId("conn-2", out var removedId);
        Assert.Equal(nodeId, removedId);
        Assert.False(registry.HasConnections());
        Assert.False(registry.TryGet(nodeId, out _));
    }

    [Fact]
    public void ManyNodes_HandlesLargeNumberOfConnections()
    {
        var registry = CreateRegistry();
        var nodeCount = 1000;
        var nodes = new List<Guid>(nodeCount);

        // Add many nodes
        for (int i = 0; i < nodeCount; i++)
        {
            var nodeId = Guid.NewGuid();
            nodes.Add(nodeId);
            registry.Set(nodeId, $"conn-{i}");
        }

        Assert.True(registry.HasConnections());
        var snapshot = registry.GetConnectedNodeIdsSnapshot();
        Assert.Equal(nodeCount, snapshot.Length);

        // Remove half
        var random = new Random(42); // Fixed seed for reproducibility
        for (int i = 0; i < nodeCount / 2; i++)
        {
            var index = random.Next(nodes.Count);
            var nodeId = nodes[index];
            if (registry.TryGet(nodeId, out var connId))
            {
                registry.TryRemoveByConnectionId(connId, out _);
                nodes.RemoveAt(index);
            }
        }

        Assert.True(registry.HasConnections());
        snapshot = registry.GetConnectedNodeIdsSnapshot();
        Assert.Equal(nodeCount / 2, snapshot.Length);
    }

    [Fact]
    public void RapidRegistrationAndRemoval_CacheInvalidationWorks()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        var iterations = 100;

        for (int i = 0; i < iterations; i++)
        {
            var connId = $"conn-{i}";
            registry.Set(nodeId, connId);

            // Get snapshot multiple times
            var snapshot = registry.GetConnectedNodeIdsSnapshot();
            Assert.Single(snapshot);
            Assert.Contains(nodeId, snapshot);

            // Remove
            registry.TryRemoveByConnectionId(connId, out _);

            // Verify empty
            snapshot = registry.GetConnectedNodeIdsSnapshot();
            Assert.Empty(snapshot);
        }

        // Final state should be empty
        Assert.False(registry.HasConnections());
        Assert.Empty(registry.GetConnectedNodeIdsSnapshot());
    }

    #endregion

    #region Thread Safety Tests

    [Fact]
    public async Task ConcurrentRegistrations_IsThreadSafe()
    {
        var registry = CreateRegistry();
        var nodeCount = 100;
        var tasks = new List<Task>();

        for (int i = 0; i < nodeCount; i++)
        {
            var nodeId = Guid.NewGuid();
            var connId = $"conn-{i}";
            tasks.Add(Task.Run(() => registry.Set(nodeId, connId)));
        }

        await Task.WhenAll(tasks);

        var snapshot = registry.GetConnectedNodeIdsSnapshot();
        Assert.Equal(nodeCount, snapshot.Length);
        Assert.True(registry.HasConnections());
    }

    [Fact]
    public async Task ConcurrentLookupAndModification_IsThreadSafe()
    {
        var registry = CreateRegistry();
        var nodeCount = 50;
        var nodes = new List<(Guid nodeId, string connId)>();

        // Initial registration
        for (int i = 0; i < nodeCount; i++)
        {
            var nodeId = Guid.NewGuid();
            nodes.Add((nodeId, $"conn-{i}"));
            registry.Set(nodeId, nodes[i].connId);
        }

        var tasks = new List<Task>();

        // Concurrent modifications
        for (int i = 0; i < nodeCount; i += 2)
        {
            var idx = i / 2;
            tasks.Add(Task.Run(() => registry.Set(nodes[idx].nodeId, $"updated-conn-{idx}")));
        }

        // Concurrent lookups
        for (int i = 0; i < nodeCount; i++)
        {
            var idx = i;
            tasks.Add(Task.Run(() =>
            {
                _ = registry.TryGet(nodes[idx].nodeId, out _);
                _ = registry.HasConnections();
                _ = registry.GetConnectedNodeIdsSnapshot();
            }));
        }

        await Task.WhenAll(tasks);

        // All nodes should still be present
        Assert.True(registry.HasConnections());
        Assert.Equal(nodeCount, registry.GetConnectedNodeIdsSnapshot().Length);
    }

    [Fact]
    public async Task ConcurrentRemovals_IsThreadSafe()
    {
        var registry = CreateRegistry();
        var nodeCount = 100;
        var connIds = new List<string>();

        // Register nodes
        for (int i = 0; i < nodeCount; i++)
        {
            var connId = $"conn-{i}";
            connIds.Add(connId);
            registry.Set(Guid.NewGuid(), connId);
        }

        var tasks = new List<Task>();

        // Remove all nodes concurrently
        foreach (var connId in connIds)
        {
            tasks.Add(Task.Run(() => registry.TryRemoveByConnectionId(connId, out _)));
        }

        await Task.WhenAll(tasks);

        // Final state should be empty
        Assert.False(registry.HasConnections());
        Assert.Empty(registry.GetConnectedNodeIdsSnapshot());
    }

    [Fact]
    public async Task ConcurrentSnapshotsDuringModification_IsThreadSafe()
    {
        var registry = CreateRegistry();
        var nodeCount = 50;
        var nodes = new List<Guid>();
        var operationCount = 1000;

        for (int i = 0; i < nodeCount; i++)
        {
            nodes.Add(Guid.NewGuid());
            registry.Set(nodes[i], $"conn-{i}");
        }

        var tasks = new List<Task>();

        // Concurrent operations
        for (int i = 0; i < operationCount; i++)
        {
            if (i % 3 == 0)
            {
                // Registration
                var idx = i % nodeCount;
                var newNode = Guid.NewGuid();
                nodes.Add(newNode);
                tasks.Add(Task.Run(() => registry.Set(newNode, $"conn-{i}")));
            }
            else if (i % 3 == 1)
            {
                // Remove
                var idx = i % nodeCount;
                if (idx < nodes.Count && registry.TryGet(nodes[idx], out var connId))
                {
                    tasks.Add(Task.Run(() => registry.TryRemoveByConnectionId(connId, out _)));
                }
            }
            else
            {
                // Snapshot
                tasks.Add(Task.Run(() => _ = registry.GetConnectedNodeIdsSnapshot()));
            }
        }

        await Task.WhenAll(tasks);

        // Registry should still be in a valid state
        var snapshot = registry.GetConnectedNodeIdsSnapshot();
        foreach (var node in snapshot)
        {
            Assert.True(registry.TryGet(node, out _));
        }
    }

    [Fact]
    public async Task ConcurrentClear_SafeWithOtherOperations()
    {
        var registry = CreateRegistry();
        var iterations = 50;

        for (int i = 0; i < iterations; i++)
        {
            // Setup
            for (int j = 0; j < 10; j++)
            {
                registry.Set(Guid.NewGuid(), $"conn-{i}-{j}");
            }

            // Clear并发
            var clearTask = Task.Run(() => registry.Clear());
            var snapshotTask = Task.Run(() => registry.GetConnectedNodeIdsSnapshot());
            var hasConnTask = Task.Run(() => registry.HasConnections());

            await Task.WhenAll(clearTask, snapshotTask, hasConnTask);

            // After clear, should be empty
            Assert.Empty(registry.GetConnectedNodeIdsSnapshot());
        }
    }

    [Fact]
    public async Task StressTest_ManyConcurrentOperations_IsStable()
    {
        var registry = CreateRegistry();
        var nodeCount = 200;
        var operationCount = 10000;
        var random = new Random(42);
        var nodes = new List<(Guid, string)>();

        // Initial setup
        for (int i = 0; i < nodeCount; i++)
        {
            var node = (Guid.NewGuid(), $"conn-{i}");
            nodes.Add(node);
            registry.Set(node.Item1, node.Item2);
        }

        var tasks = new List<Task>();

        // Run many concurrent operations
        for (int i = 0; i < operationCount; i++)
        {
            var op = random.Next(4);

            switch (op)
            {
                case 0: // Register
                    var newNode = Guid.NewGuid();
                    nodes.Add((newNode, $"conn-new-{i}"));
                    tasks.Add(Task.Run(() => registry.Set(newNode, newNode.ToString("N"))));
                    break;

                case 1: // Update existing
                    if (nodes.Count > 0)
                    {
                        var idx = random.Next(nodes.Count);
                        var nodeId = nodes[idx].Item1;
                        tasks.Add(Task.Run(() => registry.Set(nodeId, $"updated-{i}")));
                    }
                    break;

                case 2: // Lookup
                    if (nodes.Count > 0)
                    {
                        var idx = random.Next(nodes.Count);
                        var nodeId = nodes[idx].Item1;
                        tasks.Add(Task.Run(() => _ = registry.TryGet(nodeId, out _)));
                    }
                    break;

                case 3: // Snapshot
                    tasks.Add(Task.Run(() => registry.GetConnectedNodeIdsSnapshot()));
                    break;
            }
        }

        await Task.WhenAll(tasks);

        // Verify registry is still consistent
        var snapshot = registry.GetConnectedNodeIdsSnapshot();
        var hasConnections = registry.HasConnections();

        if (snapshot.Length > 0)
        {
            Assert.True(hasConnections);
            foreach (var nodeId in snapshot)
            {
                Assert.True(registry.TryGet(nodeId, out _));
            }
        }
        else
        {
            Assert.False(hasConnections);
        }
    }

    #endregion

    #region Edge Case Tests

    [Fact]
    public void EmptyStringConnectionId_WorksCorrectly()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();

        registry.Set(nodeId, "");

        Assert.True(registry.HasConnections());
        Assert.True(registry.TryGet(nodeId, out var connId));
        Assert.Equal("", connId);

        var result = registry.TryRemoveByConnectionId("", out var removedNodeId);
        Assert.True(result);
        Assert.Equal(nodeId, removedNodeId);
        Assert.False(registry.HasConnections());
    }

    [Fact]
    public void VeryLongConnectionId_WorksCorrectly()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        var longConnId = new string('a', 10000); // Very long connection ID

        registry.Set(nodeId, longConnId);

        Assert.True(registry.TryGet(nodeId, out var connId));
        Assert.Equal(longConnId, connId);

        Assert.True(registry.TryRemoveByConnectionId(longConnId, out _));
    }

    [Fact]
    public void SameNodeAfterRemoval_CanBeReRegistered()
    {
        var registry = CreateRegistry();
        var nodeId = Guid.NewGuid();
        var conn1 = "conn-1";
        var conn2 = "conn-2";

        registry.Set(nodeId, conn1);
        registry.TryRemoveByConnectionId(conn1, out _);
        registry.Set(nodeId, conn2);

        Assert.True(registry.HasConnections());
        Assert.True(registry.TryGet(nodeId, out var connId));
        Assert.Equal(conn2, connId);
    }

    [Fact]
    public void ZeroGuid_CanBeRegistered()
    {
        var registry = CreateRegistry();
        var zeroGuid = Guid.Parse("00000000-0000-0000-0000-000000000000");

        registry.Set(zeroGuid, "conn-1");

        Assert.True(registry.TryGet(zeroGuid, out var connId));
        Assert.Equal("conn-1", connId);
    }

    #endregion
}
