using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Services.Enhancements;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers;

/// <summary>
/// File browser policy management and session creation endpoints.
/// Server-side authorization checks are performed before creating sessions.
/// </summary>
[ApiController]
[Route("api/devices/{nodeId:guid}/file-browser-policies")]
public sealed class FileBrowserPoliciesController : ControllerBase
{
    private const int MaxDisplayNameChars = 255;
    private const int MaxPathChars = 1024;
    // Transport-safe upper bound: file.read results are returned via the bounded CommandQueueItem.OutputLog tail.
    // Keep chunks small enough that the JSON response (including base64) is not truncated.
    private const int MaxBytesPerReadUpperBound = 32 * 1024;

    private readonly DataContext _db;
    private readonly FileBrowserSessionService _sessions;
    private readonly RemoteToolsAuthorizationService _authorization;

    public FileBrowserPoliciesController(
        DataContext db,
        FileBrowserSessionService sessions,
        RemoteToolsAuthorizationService authorization)
    {
        _db = db;
        _sessions = sessions;
        _authorization = authorization;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<FileBrowserPolicyDto>>> List(Guid nodeId)
    {
        var nodeExists = await _db.Nodes.AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _db.FileBrowserPolicies
            .AsNoTracking()
            .Where(p => p.NodeId == nodeId)
            .OrderBy(p => p.DisplayName)
            .Select(p => new FileBrowserPolicyDto(
                p.Id,
                p.NodeId,
                p.DisplayName,
                p.RootPath,
                p.MaxBytesPerRead,
                p.CreatedAt,
                p.UpdatedAt))
            .ToListAsync();

        return Ok(items);
    }

    [HttpPost]
    public async Task<ActionResult<FileBrowserPolicyDto>> Create(Guid nodeId, [FromBody] UpsertFileBrowserPolicyRequest request)
    {
        var nodeExists = await _db.Nodes.AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound();
        }

        var displayName = (request.DisplayName ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(displayName))
        {
            return BadRequest("displayName is required");
        }

        if (displayName.Length > MaxDisplayNameChars)
        {
            return BadRequest($"displayName too long (max {MaxDisplayNameChars})");
        }

        var rootPathRaw = (request.RootPath ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(rootPathRaw))
        {
            return BadRequest("rootPath is required");
        }

        if (rootPathRaw.Length > MaxPathChars)
        {
            return BadRequest($"rootPath too long (max {MaxPathChars})");
        }

        string rootPath;
        try
        {
            rootPath = NormalizeVirtualPath(rootPathRaw);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }

        var maxBytes = request.MaxBytesPerRead ?? (256 * 1024);
        if (maxBytes <= 0 || maxBytes > MaxBytesPerReadUpperBound)
        {
            return BadRequest($"maxBytesPerRead must be between 1 and {MaxBytesPerReadUpperBound}");
        }

        var exists = await _db.FileBrowserPolicies.AnyAsync(p => p.NodeId == nodeId && p.RootPath == rootPath);
        if (exists)
        {
            return Conflict(new { message = "A policy for this rootPath already exists." });
        }

        var now = DateTime.UtcNow;
        var entity = new FileBrowserPolicy
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            DisplayName = displayName,
            RootPath = rootPath,
            MaxBytesPerRead = maxBytes,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.FileBrowserPolicies.Add(entity);
        await _db.SaveChangesAsync();

        return CreatedAtAction(nameof(List), new { nodeId }, new FileBrowserPolicyDto(
            entity.Id,
            entity.NodeId,
            entity.DisplayName,
            entity.RootPath,
            entity.MaxBytesPerRead,
            entity.CreatedAt,
            entity.UpdatedAt));
    }

    [HttpPut("{policyId:guid}")]
    public async Task<ActionResult<FileBrowserPolicyDto>> Update(Guid nodeId, Guid policyId, [FromBody] UpsertFileBrowserPolicyRequest request)
    {
        var entity = await _db.FileBrowserPolicies.FirstOrDefaultAsync(p => p.Id == policyId && p.NodeId == nodeId);
        if (entity is null)
        {
            return NotFound();
        }

        if (request.DisplayName is not null)
        {
            var displayName = request.DisplayName.Trim();
            if (string.IsNullOrWhiteSpace(displayName))
            {
                return BadRequest("displayName cannot be empty");
            }

            if (displayName.Length > MaxDisplayNameChars)
            {
                return BadRequest($"displayName too long (max {MaxDisplayNameChars})");
            }

            entity.DisplayName = displayName;
        }

        if (request.RootPath is not null)
        {
            var rootPathRaw = request.RootPath.Trim();
            if (string.IsNullOrWhiteSpace(rootPathRaw))
            {
                return BadRequest("rootPath cannot be empty");
            }

            if (rootPathRaw.Length > MaxPathChars)
            {
                return BadRequest($"rootPath too long (max {MaxPathChars})");
            }

            string rootPath;
            try
            {
                rootPath = NormalizeVirtualPath(rootPathRaw);
            }
            catch (ArgumentException ex)
            {
                return BadRequest(ex.Message);
            }

            if (!string.Equals(entity.RootPath, rootPath, StringComparison.Ordinal))
            {
                var conflict = await _db.FileBrowserPolicies.AnyAsync(p => p.NodeId == nodeId && p.RootPath == rootPath && p.Id != entity.Id);
                if (conflict)
                {
                    return Conflict(new { message = "A policy for this rootPath already exists." });
                }

                entity.RootPath = rootPath;
            }
        }

        if (request.MaxBytesPerRead.HasValue)
        {
            var maxBytes = request.MaxBytesPerRead.Value;
            if (maxBytes <= 0 || maxBytes > MaxBytesPerReadUpperBound)
            {
                return BadRequest($"maxBytesPerRead must be between 1 and {MaxBytesPerReadUpperBound}");
            }

            entity.MaxBytesPerRead = maxBytes;
        }

        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new FileBrowserPolicyDto(
            entity.Id,
            entity.NodeId,
            entity.DisplayName,
            entity.RootPath,
            entity.MaxBytesPerRead,
            entity.CreatedAt,
            entity.UpdatedAt));
    }

    [HttpDelete("{policyId:guid}")]
    public async Task<IActionResult> Delete(Guid nodeId, Guid policyId)
    {
        var entity = await _db.FileBrowserPolicies.FirstOrDefaultAsync(p => p.Id == policyId && p.NodeId == nodeId);
        if (entity is null)
        {
            return NotFound();
        }

        _db.FileBrowserPolicies.Remove(entity);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Creates a short-lived file browser session validated against the node's allowlist policy.
    /// </summary>
    [HttpPost("/api/devices/{nodeId:guid}/file-browser-sessions")]
    public async Task<ActionResult<CreateFileBrowserSessionResponse>> CreateSession(Guid nodeId, [FromBody] CreateFileBrowserSessionRequest request)
    {
        if (request.PolicyId == Guid.Empty)
        {
            return BadRequest("policyId is required");
        }

        TimeSpan? ttl = null;
        if (request.TtlSeconds is not null)
        {
            if (request.TtlSeconds.Value <= 0)
            {
                return BadRequest("ttlSeconds must be positive");
            }

            ttl = TimeSpan.FromSeconds(Math.Min(request.TtlSeconds.Value, (int)TimeSpan.FromMinutes(60).TotalSeconds));
        }

        // Authorization check: verify file browser is enabled on this node
        var (allowed, error) = await _authorization.AuthorizeFileBrowserAsync(nodeId);
        if (!allowed)
        {
            return BadRequest(error);
        }

        var result = await _sessions.CreateAsync(nodeId, request.PolicyId, ttl);
        if (!result.Success || result.Session is null)
        {
            if (string.Equals(result.Error, "Policy not found", StringComparison.OrdinalIgnoreCase))
            {
                return NotFound();
            }

            return BadRequest(result.Error ?? "Failed to create session");
        }

        return Ok(new CreateFileBrowserSessionResponse(
            SessionId: result.Session.SessionId,
            NodeId: result.Session.NodeId,
            PolicyId: result.Session.PolicyId,
            DisplayName: result.Session.DisplayName,
            RootPath: result.Session.RootPath,
            MaxBytesPerRead: result.Session.MaxBytesPerRead,
            ExpiresAt: result.Session.ExpiresAt));
    }

    /// <summary>
    /// Creates a short-lived file browser session with access to the full virtual filesystem of the node.
    ///
    /// This bypasses server-side allowlist policies and relies on:
    /// - agent-side default-deny configuration (EnableFileBrowser)
    /// - server-side feature gating (AuthorizeFileBrowserAsync)
    /// - strict virtual-path normalization (no ':' and no '..')
    /// </summary>
    [HttpPost("/api/devices/{nodeId:guid}/file-browser-sessions/system")]
    public async Task<ActionResult<CreateSystemFileBrowserSessionResponse>> CreateSystemSession(Guid nodeId, [FromBody] CreateSystemFileBrowserSessionRequest? request)
    {
        TimeSpan? ttl = null;
        if (request?.TtlSeconds is not null)
        {
            if (request.TtlSeconds.Value <= 0)
            {
                return BadRequest("ttlSeconds must be positive");
            }

            ttl = TimeSpan.FromSeconds(Math.Min(request.TtlSeconds.Value, (int)TimeSpan.FromMinutes(60).TotalSeconds));
        }

        var maxBytes = request?.MaxBytesPerRead ?? (32 * 1024);
        if (maxBytes <= 0 || maxBytes > MaxBytesPerReadUpperBound)
        {
            return BadRequest($"maxBytesPerRead must be between 1 and {MaxBytesPerReadUpperBound}");
        }

        // Authorization check: verify file browser is enabled on this node
        var (allowed, error) = await _authorization.AuthorizeFileBrowserAsync(nodeId);
        if (!allowed)
        {
            return BadRequest(error);
        }

        var result = _sessions.CreateSystemSession(nodeId, maxBytes, ttl);
        if (!result.Success || result.Session is null)
        {
            return BadRequest(result.Error ?? "Failed to create session");
        }

        return Ok(new CreateSystemFileBrowserSessionResponse(
            SessionId: result.Session.SessionId,
            NodeId: result.Session.NodeId,
            RootPath: result.Session.RootPath,
            MaxBytesPerRead: result.Session.MaxBytesPerRead,
            ExpiresAt: result.Session.ExpiresAt));
    }

    public sealed record FileBrowserPolicyDto(
        Guid Id,
        Guid NodeId,
        string DisplayName,
        string RootPath,
        int MaxBytesPerRead,
        DateTime CreatedAt,
        DateTime UpdatedAt);

    public sealed record UpsertFileBrowserPolicyRequest(string? DisplayName, string? RootPath, int? MaxBytesPerRead);

    public sealed record CreateFileBrowserSessionRequest(Guid PolicyId, int? TtlSeconds);

    public sealed record CreateFileBrowserSessionResponse(
        Guid SessionId,
        Guid NodeId,
        Guid PolicyId,
        string DisplayName,
        string RootPath,
        int MaxBytesPerRead,
        DateTime ExpiresAt);

    public sealed record CreateSystemFileBrowserSessionRequest(int? TtlSeconds, int? MaxBytesPerRead);

    public sealed record CreateSystemFileBrowserSessionResponse(
        Guid SessionId,
        Guid NodeId,
        string RootPath,
        int MaxBytesPerRead,
        DateTime ExpiresAt);

    private static string NormalizeVirtualPath(string input)
    {
        var p = (input ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(p)) return "/";

        p = p.Replace('\\', '/');

        if (!p.StartsWith('/'))
        {
            p = "/" + p;
        }

        if (p.Contains(':'))
        {
            throw new ArgumentException("Virtual paths must not contain ':'. Use '/C/...' on Windows.");
        }

        var segments = p.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var normalized = new List<string>(segments.Length);
        foreach (var seg in segments)
        {
            if (seg == ".") continue;
            if (seg == "..") throw new ArgumentException("Path traversal is not allowed.");
            normalized.Add(seg);
        }

        var joined = "/" + string.Join("/", normalized);
        // Trim trailing slash unless it's the root.
        if (joined.Length > 1 && joined.EndsWith("/", StringComparison.Ordinal))
        {
            joined = joined.TrimEnd('/');
        }

        return string.IsNullOrEmpty(joined) ? "/" : joined;
    }
}
