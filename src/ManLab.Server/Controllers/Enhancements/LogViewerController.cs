using System.Text.Json;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Enhancements;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers.Enhancements;

/// <summary>
/// Remote log viewer endpoints backed by short-lived sessions.
///
/// These endpoints validate against server-side allowlist policies, enqueue bounded commands
/// (log.read/log.tail) to the target agent, and return the resulting content.
/// Server-side authorization checks are performed before dispatching commands.
/// </summary>
[ApiController]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.LogViewerUse)]
public sealed class LogViewerController : ControllerBase
{
    private static readonly TimeSpan DefaultWaitTimeout = TimeSpan.FromSeconds(10);
    private const int PollDelayMs = 150;

    private readonly DataContext _db;
    private readonly LogViewerSessionService _sessions;
    private readonly RemoteToolsAuthorizationService _authorization;

    public LogViewerController(
        DataContext db,
        LogViewerSessionService sessions,
        RemoteToolsAuthorizationService authorization)
    {
        _db = db;
        _sessions = sessions;
        _authorization = authorization;
    }

    [HttpPost("/api/devices/{nodeId:guid}/log-viewer-sessions/{sessionId:guid}/read")]
    public async Task<ActionResult<LogReadResponse>> Read(Guid nodeId, Guid sessionId, [FromBody] LogReadRequest request)
    {
        if (!_sessions.TryGet(sessionId, out var session) || session is null)
        {
            return NotFound("Session not found or expired.");
        }

        if (session.NodeId != nodeId)
        {
            return BadRequest("Session does not belong to this node.");
        }

        var effectiveMax = request.MaxBytes ?? session.MaxBytesPerRequest;
        effectiveMax = Math.Clamp(effectiveMax, 1, session.MaxBytesPerRequest);

        if (request.OffsetBytes is not null && request.OffsetBytes.Value < 0)
        {
            return BadRequest("offsetBytes must be >= 0.");
        }

        // Ensure node exists
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound("Node not found.");
        }

        // Authorization check: verify log viewer is enabled on this node
        var (allowed, error) = await _authorization.AuthorizeLogViewerAsync(nodeId);
        if (!allowed)
        {
            return BadRequest(error);
        }

        var payload = JsonSerializer.Serialize(new
        {
            path = session.Path,
            maxBytes = effectiveMax,
            offsetBytes = request.OffsetBytes
        });

        var cmd = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            CommandType = CommandType.LogRead,
            Payload = payload,
            Status = CommandStatus.Queued,
            CreatedAt = DateTime.UtcNow
        };

        _db.CommandQueue.Add(cmd);
        await _db.SaveChangesAsync();

        var completed = await WaitForCompletionAsync(cmd.Id, DefaultWaitTimeout);
        if (completed is null)
        {
            return StatusCode(504, "Timed out waiting for agent response.");
        }

        if (completed.Status == CommandStatus.Failed)
        {
            return BadRequest(new LogReadResponse(
                SessionId: sessionId,
                NodeId: nodeId,
                Path: session.Path,
                Content: string.Empty,
                CommandId: completed.Id,
                Status: completed.Status.ToString(),
                Error: completed.OutputLog));
        }

        return Ok(new LogReadResponse(
            SessionId: sessionId,
            NodeId: nodeId,
            Path: session.Path,
            Content: completed.OutputLog ?? string.Empty,
            CommandId: completed.Id,
            Status: completed.Status.ToString(),
            Error: null));
    }

    [HttpPost("/api/devices/{nodeId:guid}/log-viewer-sessions/{sessionId:guid}/tail")]
    public async Task<ActionResult<LogTailResponse>> Tail(Guid nodeId, Guid sessionId, [FromBody] LogTailRequest request)
    {
        if (!_sessions.TryGet(sessionId, out var session) || session is null)
        {
            return NotFound("Session not found or expired.");
        }

        if (session.NodeId != nodeId)
        {
            return BadRequest("Session does not belong to this node.");
        }

        var effectiveMax = request.MaxBytes ?? session.MaxBytesPerRequest;
        effectiveMax = Math.Clamp(effectiveMax, 1, session.MaxBytesPerRequest);

        var durationSeconds = request.DurationSeconds ?? 10;
        durationSeconds = Math.Clamp(durationSeconds, 1, 60);

        // Ensure node exists
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound("Node not found.");
        }

        // Authorization check: verify log viewer is enabled on this node
        var (allowed, error) = await _authorization.AuthorizeLogViewerAsync(nodeId);
        if (!allowed)
        {
            return BadRequest(error);
        }

        var payload = JsonSerializer.Serialize(new
        {
            path = session.Path,
            maxBytes = effectiveMax,
            durationSeconds
        });

        var cmd = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            CommandType = CommandType.LogTail,
            Payload = payload,
            Status = CommandStatus.Queued,
            CreatedAt = DateTime.UtcNow
        };

        _db.CommandQueue.Add(cmd);
        await _db.SaveChangesAsync();

        // For tail, we wait for completion as well (bounded tail duration), returning whatever output was produced.
        var completed = await WaitForCompletionAsync(cmd.Id, TimeSpan.FromSeconds(durationSeconds + 10));
        if (completed is null)
        {
            return StatusCode(504, "Timed out waiting for agent response.");
        }

        return Ok(new LogTailResponse(
            SessionId: sessionId,
            NodeId: nodeId,
            Path: session.Path,
            Content: completed.OutputLog ?? string.Empty,
            CommandId: completed.Id,
            Status: completed.Status.ToString()));
    }

    private async Task<CommandQueueItem?> WaitForCompletionAsync(Guid commandId, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline)
        {
            var cmd = await _db.CommandQueue
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == commandId);

            if (cmd is null)
            {
                return null;
            }

            if (cmd.Status is CommandStatus.Success or CommandStatus.Failed)
            {
                return cmd;
            }

            await Task.Delay(PollDelayMs);
        }

        return null;
    }

    public sealed record LogReadRequest(long? OffsetBytes, int? MaxBytes);

    public sealed record LogReadResponse(
        Guid SessionId,
        Guid NodeId,
        string Path,
        string Content,
        Guid CommandId,
        string Status,
        string? Error);

    public sealed record LogTailRequest(int? MaxBytes, int? DurationSeconds);

    public sealed record LogTailResponse(
        Guid SessionId,
        Guid NodeId,
        string Path,
        string Content,
        Guid CommandId,
        string Status);
}
