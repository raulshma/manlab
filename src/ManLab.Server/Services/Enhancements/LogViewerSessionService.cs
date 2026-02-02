using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// Session issuance for log viewer access using HybridCache.
/// Sessions are short-lived and validated against <see cref="LogViewerPolicy"/> allowlists.
/// </summary>
public sealed class LogViewerSessionService
{
    private static readonly TimeSpan DefaultTtl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MaxTtl = TimeSpan.FromMinutes(60);

    private readonly DataContext _db;
    private readonly ICacheService _cache;
    private readonly ILogger<LogViewerSessionService> _logger;

    private const string CacheKeyPrefix = "session:logviewer:";
    private const string SessionsTag = "sessions";
    private const string LogViewerSessionsTag = "logviewer-sessions";

    public LogViewerSessionService(DataContext db, ICacheService cache, ILogger<LogViewerSessionService> logger)
    {
        _db = db;
        _cache = cache;
        _logger = logger;
    }

    public sealed record Session(
        Guid SessionId,
        Guid NodeId,
        Guid PolicyId,
        string DisplayName,
        string Path,
        int MaxBytesPerRequest,
        DateTime CreatedAt,
        DateTime ExpiresAt);

    public sealed record CreateSessionResult(bool Success, string? Error, Session? Session);

    public async Task<CreateSessionResult> CreateAsync(Guid nodeId, Guid policyId, TimeSpan? ttl = null)
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

        var policy = await _db.LogViewerPolicies
            .AsNoTracking()
            .FirstOrDefaultAsync(p => p.Id == policyId && p.NodeId == nodeId);

        if (policy is null)
        {
            return new CreateSessionResult(false, "Policy not found", null);
        }

        var now = DateTime.UtcNow;
        var sessionId = Guid.NewGuid();
        var session = new Session(
            SessionId: sessionId,
            NodeId: nodeId,
            PolicyId: policy.Id,
            DisplayName: policy.DisplayName,
            Path: policy.Path,
            MaxBytesPerRequest: policy.MaxBytesPerRequest,
            CreatedAt: now,
            ExpiresAt: now.Add(effectiveTtl));

        await _cache.SetAsync(
            GetCacheKey(sessionId),
            session,
            expiration: effectiveTtl,
            tags: new[] { SessionsTag, LogViewerSessionsTag });

        _logger.LogInformation("Log viewer session created {SessionId} for node {NodeId} policy {PolicyId}", sessionId, nodeId, policyId);

        return new CreateSessionResult(true, null, session);
    }

    public async Task<(bool Success, Session? Session)> TryGetAsync(Guid sessionId)
    {
        var cacheKey = GetCacheKey(sessionId);

        var session = await _cache.GetOrCreateAsync(
            cacheKey,
            _ => ValueTask.FromResult<Session?>(null),
            expiration: TimeSpan.FromMinutes(5),
            tags: new[] { SessionsTag, LogViewerSessionsTag });

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

    private static string GetCacheKey(Guid sessionId) => $"{CacheKeyPrefix}{sessionId:N}";
}
