using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Audit;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// In-memory session management for restricted terminal access.
/// Sessions are short-lived, audited, and expire automatically.
/// </summary>
public sealed class TerminalSessionService
{
    private static readonly TimeSpan DefaultTtl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MaxTtl = TimeSpan.FromMinutes(30);

    private readonly DataContext _db;
    private readonly IMemoryCache _cache;
    private readonly ILogger<TerminalSessionService> _logger;
    private readonly IAuditLog _audit;

    public TerminalSessionService(DataContext db, IMemoryCache cache, ILogger<TerminalSessionService> logger, IAuditLog audit)
    {
        _db = db;
        _cache = cache;
        _logger = logger;
        _audit = audit;
    }

    public sealed record Session(
        Guid SessionId,
        Guid NodeId,
        string? RequestedBy,
        DateTime CreatedAt,
        DateTime ExpiresAt);

    public sealed record CreateSessionResult(bool Success, string? Error, Session? Session);

    /// <summary>
    /// Creates a new terminal session for a node.
    /// </summary>
    /// <param name="nodeId">The target node ID.</param>
    /// <param name="requestedBy">User/requester identity for auditing.</param>
    /// <param name="ttl">Optional TTL override (clamped to max).</param>
    public async Task<CreateSessionResult> CreateAsync(Guid nodeId, string? requestedBy, TimeSpan? ttl = null)
    {
        var effectiveTtl = ttl ?? DefaultTtl;
        if (effectiveTtl <= TimeSpan.Zero)
        {
            return new CreateSessionResult(false, "ttl must be positive", null);
        }

        if (effectiveTtl > MaxTtl)
        {
            effectiveTtl = MaxTtl;
        }

        // Verify node exists
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return new CreateSessionResult(false, "Node not found", null);
        }

        var now = DateTime.UtcNow;
        var sessionId = Guid.NewGuid();
        var expiresAt = now.Add(effectiveTtl);

        // Persist to database for auditing
        var dbSession = new TerminalSession
        {
            Id = sessionId,
            NodeId = nodeId,
            RequestedBy = requestedBy?.Length > 128 ? requestedBy[..128] : requestedBy,
            CreatedAt = now,
            ExpiresAt = expiresAt,
            Status = TerminalSessionStatus.Open
        };

        _db.TerminalSessions.Add(dbSession);
        await _db.SaveChangesAsync();

        var session = new Session(
            SessionId: sessionId,
            NodeId: nodeId,
            RequestedBy: requestedBy,
            CreatedAt: now,
            ExpiresAt: expiresAt);

        // Cache for fast lookups
        _cache.Set(GetCacheKey(sessionId), session, new MemoryCacheEntryOptions
        {
            AbsoluteExpiration = expiresAt
        });

        _logger.LogInformation("Terminal session created {SessionId} for node {NodeId} by {RequestedBy}",
            sessionId, nodeId, requestedBy ?? "unknown");

        _audit.TryEnqueue(new ManLab.Server.Data.Entities.AuditEvent
        {
            Kind = "audit",
            EventName = "terminal.session.created",
            Category = "terminal",
            Source = "system",
            ActorType = "dashboard",
            ActorName = requestedBy,
            NodeId = nodeId,
            SessionId = sessionId,
            Success = true,
            Message = "Terminal session created"
        });

        return new CreateSessionResult(true, null, session);
    }

    /// <summary>
    /// Attempts to get an active session from cache.
    /// </summary>
    public bool TryGet(Guid sessionId, out Session? session)
    {
        if (_cache.TryGetValue(GetCacheKey(sessionId), out Session? s))
        {
            session = s;
            return true;
        }

        session = null;
        return false;
    }

    /// <summary>
    /// Closes a terminal session.
    /// </summary>
    public async Task<bool> CloseAsync(Guid sessionId)
    {
        _cache.Remove(GetCacheKey(sessionId));

        var dbSession = await _db.TerminalSessions.FirstOrDefaultAsync(s => s.Id == sessionId);
        if (dbSession is null)
        {
            return false;
        }

        dbSession.Status = TerminalSessionStatus.Closed;
        dbSession.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Terminal session closed {SessionId}", sessionId);

        _audit.TryEnqueue(new ManLab.Server.Data.Entities.AuditEvent
        {
            Kind = "activity",
            EventName = "terminal.session.closed",
            Category = "terminal",
            Source = "system",
            ActorType = "system",
            ActorName = nameof(TerminalSessionService),
            NodeId = dbSession.NodeId,
            SessionId = sessionId,
            Success = true,
            Message = "Terminal session closed"
        });
        return true;
    }

    /// <summary>
    /// Marks a session as expired (called when agent reports session end).
    /// </summary>
    public async Task<bool> MarkExpiredAsync(Guid sessionId)
    {
        _cache.Remove(GetCacheKey(sessionId));

        var dbSession = await _db.TerminalSessions.FirstOrDefaultAsync(s => s.Id == sessionId);
        if (dbSession is null)
        {
            return false;
        }

        dbSession.Status = TerminalSessionStatus.Expired;
        dbSession.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Terminal session expired {SessionId}", sessionId);

        _audit.TryEnqueue(new ManLab.Server.Data.Entities.AuditEvent
        {
            Kind = "activity",
            EventName = "terminal.session.expired",
            Category = "terminal",
            Source = "system",
            ActorType = "system",
            ActorName = nameof(TerminalSessionService),
            NodeId = dbSession.NodeId,
            SessionId = sessionId,
            Success = true,
            Message = "Terminal session expired"
        });
        return true;
    }

    /// <summary>
    /// Marks a session as failed.
    /// </summary>
    public async Task<bool> MarkFailedAsync(Guid sessionId)
    {
        _cache.Remove(GetCacheKey(sessionId));

        var dbSession = await _db.TerminalSessions.FirstOrDefaultAsync(s => s.Id == sessionId);
        if (dbSession is null)
        {
            return false;
        }

        dbSession.Status = TerminalSessionStatus.Failed;
        dbSession.ClosedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        _logger.LogInformation("Terminal session failed {SessionId}", sessionId);

        _audit.TryEnqueue(new ManLab.Server.Data.Entities.AuditEvent
        {
            Kind = "audit",
            EventName = "terminal.session.failed",
            Category = "terminal",
            Source = "system",
            ActorType = "system",
            ActorName = nameof(TerminalSessionService),
            NodeId = dbSession.NodeId,
            SessionId = sessionId,
            Success = false,
            Message = "Terminal session failed"
        });
        return true;
    }

    private static string GetCacheKey(Guid sessionId) => $"terminal.session.{sessionId:N}";
}
