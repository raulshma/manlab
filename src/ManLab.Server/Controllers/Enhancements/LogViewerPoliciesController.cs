using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Services.Enhancements;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers;

/// <summary>
/// Log viewer policy management and session creation endpoints.
/// Server-side authorization checks are performed before creating sessions.
/// </summary>
[ApiController]
[Route("api/devices/{nodeId:guid}/log-viewer-policies")]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.LogViewerUse)]
public sealed class LogViewerPoliciesController : ControllerBase
{
    private const int MaxDisplayNameChars = 255;
    private const int MaxPathChars = 1024;

    private readonly DataContext _db;
    private readonly LogViewerSessionService _sessions;
    private readonly RemoteToolsAuthorizationService _authorization;

    public LogViewerPoliciesController(
        DataContext db,
        LogViewerSessionService sessions,
        RemoteToolsAuthorizationService authorization)
    {
        _db = db;
        _sessions = sessions;
        _authorization = authorization;
    }

    [HttpGet]
    public async Task<ActionResult<IEnumerable<LogViewerPolicyDto>>> List(Guid nodeId)
    {
        var nodeExists = await _db.Nodes.AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound();
        }

        var items = await _db.LogViewerPolicies
            .AsNoTracking()
            .Where(p => p.NodeId == nodeId)
            .OrderBy(p => p.DisplayName)
            .Select(p => new LogViewerPolicyDto(
                p.Id,
                p.NodeId,
                p.DisplayName,
                p.Path,
                p.MaxBytesPerRequest,
                p.CreatedAt,
                p.UpdatedAt))
            .ToListAsync();

        return Ok(items);
    }

    [HttpPost]
    public async Task<ActionResult<LogViewerPolicyDto>> Create(Guid nodeId, [FromBody] UpsertLogViewerPolicyRequest request)
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

        var path = (request.Path ?? string.Empty).Trim();
        if (string.IsNullOrWhiteSpace(path))
        {
            return BadRequest("path is required");
        }

        if (path.Length > MaxPathChars)
        {
            return BadRequest($"path too long (max {MaxPathChars})");
        }

        var maxBytes = request.MaxBytesPerRequest ?? (64 * 1024);
        if (maxBytes <= 0 || maxBytes > (1024 * 1024))
        {
            return BadRequest("maxBytesPerRequest must be between 1 and 1048576");
        }

        var exists = await _db.LogViewerPolicies.AnyAsync(p => p.NodeId == nodeId && p.Path == path);
        if (exists)
        {
            return Conflict(new { message = "A policy for this path already exists." });
        }

        var now = DateTime.UtcNow;
        var entity = new LogViewerPolicy
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            DisplayName = displayName,
            Path = path,
            MaxBytesPerRequest = maxBytes,
            CreatedAt = now,
            UpdatedAt = now
        };

        _db.LogViewerPolicies.Add(entity);
        await _db.SaveChangesAsync();

        return CreatedAtAction(nameof(List), new { nodeId }, new LogViewerPolicyDto(
            entity.Id,
            entity.NodeId,
            entity.DisplayName,
            entity.Path,
            entity.MaxBytesPerRequest,
            entity.CreatedAt,
            entity.UpdatedAt));
    }

    [HttpPut("{policyId:guid}")]
    public async Task<ActionResult<LogViewerPolicyDto>> Update(Guid nodeId, Guid policyId, [FromBody] UpsertLogViewerPolicyRequest request)
    {
        var entity = await _db.LogViewerPolicies.FirstOrDefaultAsync(p => p.Id == policyId && p.NodeId == nodeId);
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

        if (request.Path is not null)
        {
            var path = request.Path.Trim();
            if (string.IsNullOrWhiteSpace(path))
            {
                return BadRequest("path cannot be empty");
            }

            if (path.Length > MaxPathChars)
            {
                return BadRequest($"path too long (max {MaxPathChars})");
            }

            if (!string.Equals(entity.Path, path, StringComparison.Ordinal))
            {
                var conflict = await _db.LogViewerPolicies.AnyAsync(p => p.NodeId == nodeId && p.Path == path && p.Id != entity.Id);
                if (conflict)
                {
                    return Conflict(new { message = "A policy for this path already exists." });
                }

                entity.Path = path;
            }
        }

        if (request.MaxBytesPerRequest.HasValue)
        {
            var maxBytes = request.MaxBytesPerRequest.Value;
            if (maxBytes <= 0 || maxBytes > (1024 * 1024))
            {
                return BadRequest("maxBytesPerRequest must be between 1 and 1048576");
            }

            entity.MaxBytesPerRequest = maxBytes;
        }

        entity.UpdatedAt = DateTime.UtcNow;
        await _db.SaveChangesAsync();

        return Ok(new LogViewerPolicyDto(
            entity.Id,
            entity.NodeId,
            entity.DisplayName,
            entity.Path,
            entity.MaxBytesPerRequest,
            entity.CreatedAt,
            entity.UpdatedAt));
    }

    [HttpDelete("{policyId:guid}")]
    public async Task<IActionResult> Delete(Guid nodeId, Guid policyId)
    {
        var entity = await _db.LogViewerPolicies.FirstOrDefaultAsync(p => p.Id == policyId && p.NodeId == nodeId);
        if (entity is null)
        {
            return NotFound();
        }

        _db.LogViewerPolicies.Remove(entity);
        await _db.SaveChangesAsync();
        return NoContent();
    }

    /// <summary>
    /// Creates a short-lived log viewer session validated against the node's allowlist policy.
    /// </summary>
    [HttpPost("/api/devices/{nodeId:guid}/log-viewer-sessions")]
    public async Task<ActionResult<CreateLogViewerSessionResponse>> CreateSession(Guid nodeId, [FromBody] CreateLogViewerSessionRequest request)
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

        // Authorization check: verify log viewer is enabled on this node
        var (allowed, error) = await _authorization.AuthorizeLogViewerAsync(nodeId);
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

        return Ok(new CreateLogViewerSessionResponse(
            SessionId: result.Session.SessionId,
            NodeId: result.Session.NodeId,
            PolicyId: result.Session.PolicyId,
            DisplayName: result.Session.DisplayName,
            Path: result.Session.Path,
            MaxBytesPerRequest: result.Session.MaxBytesPerRequest,
            ExpiresAt: result.Session.ExpiresAt));
    }

    public sealed record LogViewerPolicyDto(
        Guid Id,
        Guid NodeId,
        string DisplayName,
        string Path,
        int MaxBytesPerRequest,
        DateTime CreatedAt,
        DateTime UpdatedAt);

    public sealed record UpsertLogViewerPolicyRequest(string? DisplayName, string? Path, int? MaxBytesPerRequest);

    public sealed record CreateLogViewerSessionRequest(Guid PolicyId, int? TtlSeconds);

    public sealed record CreateLogViewerSessionResponse(
        Guid SessionId,
        Guid NodeId,
        Guid PolicyId,
        string DisplayName,
        string Path,
        int MaxBytesPerRequest,
        DateTime ExpiresAt);
}
