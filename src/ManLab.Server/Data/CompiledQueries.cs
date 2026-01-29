using ManLab.Server.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Data;

/// <summary>
/// Compiled EF Core queries for frequently executed database operations.
/// Reduces expression tree compilation overhead in hot paths.
/// </summary>
public static class CompiledQueries
{
    /// <summary>
    /// Gets a node by its authentication key hash.
    /// Used during agent registration/heartbeat authentication.
    /// </summary>
    public static readonly Func<DataContext, string, Task<Node?>> GetNodeByAuthKeyHashAsync =
        EF.CompileAsyncQuery((DataContext db, string tokenHash) =>
            db.Nodes.SingleOrDefault(n => n.AuthKeyHash != null && n.AuthKeyHash == tokenHash));

    /// <summary>
    /// Checks if a node exists by ID.
    /// Used in telemetry and settings endpoints.
    /// </summary>
    public static readonly Func<DataContext, Guid, Task<bool>> NodeExistsAsync =
        EF.CompileAsyncQuery((DataContext db, Guid nodeId) =>
            db.Nodes.Any(n => n.Id == nodeId));

    /// <summary>
    /// Gets a node by ID for read operations.
    /// </summary>
    public static readonly Func<DataContext, Guid, Task<Node?>> GetNodeByIdAsync =
        EF.CompileAsyncQuery((DataContext db, Guid nodeId) =>
            db.Nodes.SingleOrDefault(n => n.Id == nodeId));

    /// <summary>
    /// Gets an unused enrollment token by hash.
    /// Used during new agent registration.
    /// </summary>
    public static readonly Func<DataContext, string, DateTime, Task<EnrollmentToken?>> GetValidEnrollmentTokenAsync =
        EF.CompileAsyncQuery((DataContext db, string tokenHash, DateTime utcNow) =>
            db.EnrollmentTokens.SingleOrDefault(t =>
                t.TokenHash == tokenHash &&
                t.UsedAt == null &&
                t.ExpiresAt > utcNow));
}
