using System.Text.Json;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Enhancements;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers.Enhancements;

/// <summary>
/// Restricted terminal endpoints for remote command execution.
/// 
/// Sessions are:
/// - Ephemeral (auto-expire after TTL)
/// - Audited (requester identity persisted)
/// - Bounded (max output size enforced agent-side)
/// 
/// The terminal feature is disabled by default on agents (EnableTerminal: false).
/// Server-side authorization checks are performed before dispatching commands.
/// </summary>
[ApiController]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.TerminalUse)]
public sealed class TerminalController : ControllerBase
{
    private static readonly TimeSpan DefaultWaitTimeout = TimeSpan.FromSeconds(10);
    private const int PollDelayMs = 150;

    private readonly DataContext _db;
    private readonly TerminalSessionService _sessions;
    private readonly RemoteToolsAuthorizationService _authorization;
    private readonly IHubContext<AgentHub> _hubContext;
    private readonly ILogger<TerminalController> _logger;

    public TerminalController(
        DataContext db,
        TerminalSessionService sessions,
        RemoteToolsAuthorizationService authorization,
        IHubContext<AgentHub> hubContext,
        ILogger<TerminalController> logger)
    {
        _db = db;
        _sessions = sessions;
        _authorization = authorization;
        _hubContext = hubContext;
        _logger = logger;
    }


    /// <summary>
    /// Opens a new terminal session for a node.
    /// </summary>
    [HttpPost("/api/devices/{nodeId:guid}/terminal/open")]
    public async Task<ActionResult<TerminalOpenResponse>> Open(Guid nodeId, [FromBody] TerminalOpenRequest? request)
    {
        // Verify node exists and is online
        var node = await _db.Nodes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == nodeId);
        if (node is null)
        {
            return NotFound("Node not found.");
        }

        if (node.Status != NodeStatus.Online)
        {
            return BadRequest("Node is not connected.");
        }

        // Authorization check: verify terminal is enabled on this node
        var (allowed, error) = await _authorization.AuthorizeTerminalAsync(nodeId);
        if (!allowed)
        {
            return BadRequest(error);
        }

        // Capture requester identity for audit trail; prefer user identity over request body
        var requestedBy = User?.Identity?.Name ?? request?.RequestedBy;

        // Optional TTL override from client (seconds)
        TimeSpan? ttl = null;
        if (request?.TtlSeconds is int ttlSeconds)
        {
            if (ttlSeconds <= 0)
            {
                return BadRequest("ttlSeconds must be positive");
            }

            ttl = TimeSpan.FromSeconds(ttlSeconds);
        }

        // Create session
        var result = await _sessions.CreateAsync(nodeId, requestedBy, ttl);
        if (!result.Success || result.Session is null)
        {
            return BadRequest(result.Error ?? "Failed to create session.");
        }

        var session = result.Session;

        // Enqueue terminal.open command
        var payload = JsonSerializer.Serialize(new { sessionId = session.SessionId });
        var cmd = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            CommandType = CommandType.TerminalOpen,
            Payload = payload,
            Status = CommandStatus.Queued,
            CreatedAt = DateTime.UtcNow
        };

        _db.CommandQueue.Add(cmd);
        await _db.SaveChangesAsync();

        _logger.LogInformation("Terminal open command {CommandId} enqueued for session {SessionId}", cmd.Id, session.SessionId);

        return Ok(new TerminalOpenResponse(
            SessionId: session.SessionId,
            NodeId: nodeId,
            CommandId: cmd.Id,
            ExpiresAt: session.ExpiresAt));
    }

    /// <summary>
    /// Sends input to a terminal session.
    /// </summary>
    [HttpPost("/api/devices/{nodeId:guid}/terminal/{sessionId:guid}/input")]
    public async Task<ActionResult<TerminalInputResponse>> SendInput(Guid nodeId, Guid sessionId, [FromBody] TerminalInputRequest request)
    {
        if (string.IsNullOrEmpty(request.Input))
        {
            return BadRequest("Input cannot be empty.");
        }

        if (!_sessions.TryGet(sessionId, out var session) || session is null)
        {
            return NotFound("Session not found or expired.");
        }

        if (session.NodeId != nodeId)
        {
            return BadRequest("Session does not belong to this node.");
        }

        // Verify node is still connected
        var node = await _db.Nodes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == nodeId);
        if (node is null || node.Status != NodeStatus.Online)
        {
            return BadRequest("Node is not connected.");
        }

        // Enqueue terminal.input command
        var payload = JsonSerializer.Serialize(new { sessionId, input = request.Input });
        var cmd = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            CommandType = CommandType.TerminalInput,
            Payload = payload,
            Status = CommandStatus.Queued,
            CreatedAt = DateTime.UtcNow
        };

        _db.CommandQueue.Add(cmd);
        await _db.SaveChangesAsync();

        return Ok(new TerminalInputResponse(
            SessionId: sessionId,
            CommandId: cmd.Id));
    }

    /// <summary>
    /// Closes a terminal session.
    /// </summary>
    [HttpPost("/api/devices/{nodeId:guid}/terminal/{sessionId:guid}/close")]
    public async Task<ActionResult<TerminalCloseResponse>> Close(Guid nodeId, Guid sessionId)
    {
        if (!_sessions.TryGet(sessionId, out var session) || session is null)
        {
            // Session may have already expired, still try to close in DB
            await _sessions.CloseAsync(sessionId);
            return Ok(new TerminalCloseResponse(SessionId: sessionId, CommandId: null));
        }

        if (session.NodeId != nodeId)
        {
            return BadRequest("Session does not belong to this node.");
        }

        // Verify node is connected
        var node = await _db.Nodes.AsNoTracking().FirstOrDefaultAsync(n => n.Id == nodeId);
        Guid? commandId = null;

        if (node is not null && node.Status == NodeStatus.Online)
        {
            // Enqueue terminal.close command
            var payload = JsonSerializer.Serialize(new { sessionId });
            var cmd = new CommandQueueItem
            {
                Id = Guid.NewGuid(),
                NodeId = nodeId,
                CommandType = CommandType.TerminalClose,
                Payload = payload,
                Status = CommandStatus.Queued,
                CreatedAt = DateTime.UtcNow
            };

            _db.CommandQueue.Add(cmd);
            await _db.SaveChangesAsync();
            commandId = cmd.Id;
        }

        await _sessions.CloseAsync(sessionId);

        return Ok(new TerminalCloseResponse(SessionId: sessionId, CommandId: commandId));
    }

    /// <summary>
    /// Gets the status of a terminal session.
    /// </summary>
    [HttpGet("/api/devices/{nodeId:guid}/terminal/{sessionId:guid}")]
    public async Task<ActionResult<TerminalSessionResponse>> GetSession(Guid nodeId, Guid sessionId)
    {
        // First check cache
        if (_sessions.TryGet(sessionId, out var cachedSession) && cachedSession is not null)
        {
            if (cachedSession.NodeId != nodeId)
            {
                return BadRequest("Session does not belong to this node.");
            }

            return Ok(new TerminalSessionResponse(
                SessionId: cachedSession.SessionId,
                NodeId: cachedSession.NodeId,
                Status: "Open",
                CreatedAt: cachedSession.CreatedAt,
                ExpiresAt: cachedSession.ExpiresAt,
                ClosedAt: null));
        }

        // Fall back to database
        var dbSession = await _db.TerminalSessions
            .AsNoTracking()
            .FirstOrDefaultAsync(s => s.Id == sessionId);

        if (dbSession is null)
        {
            return NotFound("Session not found.");
        }

        if (dbSession.NodeId != nodeId)
        {
            return BadRequest("Session does not belong to this node.");
        }

        return Ok(new TerminalSessionResponse(
            SessionId: dbSession.Id,
            NodeId: dbSession.NodeId,
            Status: dbSession.Status.ToString(),
            CreatedAt: dbSession.CreatedAt,
            ExpiresAt: dbSession.ExpiresAt,
            ClosedAt: dbSession.ClosedAt));
    }

    // DTOs
    public sealed record TerminalOpenRequest(string? RequestedBy, int? TtlSeconds);

    public sealed record TerminalOpenResponse(
        Guid SessionId,
        Guid NodeId,
        Guid CommandId,
        DateTime ExpiresAt);

    public sealed record TerminalInputRequest(string Input);

    public sealed record TerminalInputResponse(
        Guid SessionId,
        Guid CommandId);

    public sealed record TerminalCloseResponse(
        Guid SessionId,
        Guid? CommandId);

    public sealed record TerminalSessionResponse(
        Guid SessionId,
        Guid NodeId,
        string Status,
        DateTime CreatedAt,
        DateTime ExpiresAt,
        DateTime? ClosedAt);
}
