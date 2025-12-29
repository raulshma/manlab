using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// In-memory session issuance for file browser access.
/// Sessions are short-lived and validated against <see cref="FileBrowserPolicy"/> allowlists.
/// </summary>
public sealed class FileBrowserSessionService
{
    private static readonly TimeSpan DefaultTtl = TimeSpan.FromMinutes(10);
    private static readonly TimeSpan MaxTtl = TimeSpan.FromMinutes(60);

    private readonly DataContext _db;
    private readonly IMemoryCache _cache;
    private readonly ILogger<FileBrowserSessionService> _logger;

    public FileBrowserSessionService(DataContext db, IMemoryCache cache, ILogger<FileBrowserSessionService> logger)
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
        string RootPath,
        int MaxBytesPerRead,
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

        var policy = await _db.FileBrowserPolicies
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
            RootPath: policy.RootPath,
            MaxBytesPerRead: policy.MaxBytesPerRead,
            CreatedAt: now,
            ExpiresAt: now.Add(effectiveTtl));

        _cache.Set(GetCacheKey(sessionId), session, new MemoryCacheEntryOptions
        {
            AbsoluteExpiration = session.ExpiresAt
        });

        _logger.LogInformation("File browser session created {SessionId} for node {NodeId} policy {PolicyId}", sessionId, nodeId, policyId);

        return new CreateSessionResult(true, null, session);
    }

    public CreateSessionResult CreateSystemSession(Guid nodeId, int maxBytesPerRead, TimeSpan? ttl = null)
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

        // Full system session: root is '/' (drives list on Windows, filesystem root on Unix).
        // Uses Guid.Empty for PolicyId to differentiate from policy-backed sessions.
        var now = DateTime.UtcNow;
        var sessionId = Guid.NewGuid();
        var session = new Session(
            SessionId: sessionId,
            NodeId: nodeId,
            PolicyId: Guid.Empty,
            DisplayName: "System",
            RootPath: "/",
            MaxBytesPerRead: maxBytesPerRead,
            CreatedAt: now,
            ExpiresAt: now.Add(effectiveTtl));

        _cache.Set(GetCacheKey(sessionId), session, new MemoryCacheEntryOptions
        {
            AbsoluteExpiration = session.ExpiresAt
        });

        _logger.LogInformation("File browser system session created {SessionId} for node {NodeId}", sessionId, nodeId);

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

    private static string GetCacheKey(Guid sessionId) => $"filebrowser.session.{sessionId:N}";
}
