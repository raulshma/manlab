using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// In-memory session issuance for log viewer access.
/// Sessions are short-lived and validated against <see cref="LogViewerPolicy"/> allowlists.
/// </summary>
public sealed class LogViewerSessionService
{
    private static readonly TimeSpan DefaultTtl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MaxTtl = TimeSpan.FromMinutes(60);

    private readonly DataContext _db;
    private readonly IMemoryCache _cache;
    private readonly ILogger<LogViewerSessionService> _logger;

    public LogViewerSessionService(DataContext db, IMemoryCache cache, ILogger<LogViewerSessionService> logger)
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

        _cache.Set(GetCacheKey(sessionId), session, new MemoryCacheEntryOptions
        {
            AbsoluteExpiration = session.ExpiresAt,
            Size = 1 // Track size for cache limits
        });

        _logger.LogInformation("Log viewer session created {SessionId} for node {NodeId} policy {PolicyId}", sessionId, nodeId, policyId);

        return new CreateSessionResult(true, null, session);
    }

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

    private static string GetCacheKey(Guid sessionId) => $"logviewer.session.{sessionId:N}";
}
