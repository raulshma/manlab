using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Audit;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// Session management for restricted terminal access using HybridCache.
/// Sessions are short-lived, audited, and expire automatically.
/// </summary>
public sealed class TerminalSessionService
{
    private static readonly TimeSpan DefaultTtl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MaxTtl = TimeSpan.FromMinutes(30);

    private readonly DataContext _db;
    private readonly ICacheService _cache;
    private readonly ILogger<TerminalSessionService> _logger;
    private readonly IAuditLog _audit;

    private const string CacheKeyPrefix = "session:terminal:";
    private const string SessionsTag = "sessions";
    private const string TerminalSessionsTag = "terminal-sessions";

    public TerminalSessionService(DataContext db, ICacheService cache, ILogger<TerminalSessionService> logger, IAuditLog audit)
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
        await _cache.SetAsync(
            GetCacheKey(sessionId),
            session,
            expiration: effectiveTtl,
            tags: new[] { SessionsTag, TerminalSessionsTag });

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
    public async Task<(bool Success, Session? Session)> TryGetAsync(Guid sessionId)
    {
        var cacheKey = GetCacheKey(sessionId);

        var session = await _cache.GetOrCreateAsync(
            cacheKey,
            async ct =>
            {
                // Fallback to database if not in cache
                var dbSession = await _db.TerminalSessions
                    .AsNoTracking()
                    .FirstOrDefaultAsync(s => s.Id == sessionId && s.Status == TerminalSessionStatus.Open, ct);

                if (dbSession is null || dbSession.ExpiresAt <= DateTime.UtcNow)
                {
                    return null;
                }

                return new Session(
                    SessionId: dbSession.Id,
                    NodeId: dbSession.NodeId,
                    RequestedBy: dbSession.RequestedBy,
                    CreatedAt: dbSession.CreatedAt,
                    ExpiresAt: dbSession.ExpiresAt);
            },
            expiration: TimeSpan.FromMinutes(5),
            tags: new[] { SessionsTag, TerminalSessionsTag });

        if (session is null)
        {
            return (false, null);
        }

        // Check if session has expired
        if (session.ExpiresAt <= DateTime.UtcNow)
        {
            await _cache.RemoveAsync(cacheKey);
            return (false, null);
        }

        return (true, session);
    }

    /// <summary>
    /// Closes a terminal session.
    /// </summary>
    public async Task<bool> CloseAsync(Guid sessionId)
    {
        await _cache.RemoveAsync(GetCacheKey(sessionId));

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
        await _cache.RemoveAsync(GetCacheKey(sessionId));

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
        await _cache.RemoveAsync(GetCacheKey(sessionId));

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

    private static string GetCacheKey(Guid sessionId) => $"{CacheKeyPrefix}{sessionId:N}";
}
