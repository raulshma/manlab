using System.Text.Json;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Services.Enhancements;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers.Enhancements;

/// <summary>
/// Remote file browser endpoints backed by short-lived sessions.
///
/// These endpoints validate against server-side allowlist policies, enqueue bounded commands
/// (file.list/file.read) to the target agent, and return the resulting content.
/// Server-side authorization checks are performed before dispatching commands.
/// </summary>
[ApiController]
public sealed class FileBrowserController : ControllerBase
{
    private static readonly TimeSpan DefaultWaitTimeout = TimeSpan.FromSeconds(10);
    private const int PollDelayMs = 150;

    private readonly DataContext _db;
    private readonly FileBrowserSessionService _sessions;
    private readonly RemoteToolsAuthorizationService _authorization;

    public FileBrowserController(
        DataContext db,
        FileBrowserSessionService sessions,
        RemoteToolsAuthorizationService authorization)
    {
        _db = db;
        _sessions = sessions;
        _authorization = authorization;
    }

    [HttpPost("/api/devices/{nodeId:guid}/file-browser-sessions/{sessionId:guid}/list")]
    public async Task<ActionResult<FileListResponse>> List(Guid nodeId, Guid sessionId, [FromBody] FileListRequest? request)
    {
        if (!_sessions.TryGet(sessionId, out var session) || session is null)
        {
            return NotFound("Session not found or expired.");
        }

        if (session.NodeId != nodeId)
        {
            return BadRequest("Session does not belong to this node.");
        }

        // Ensure node exists
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound("Node not found.");
        }

        // Authorization check: verify file browser is enabled on this node
        var (allowed, error) = await _authorization.AuthorizeFileBrowserAsync(nodeId);
        if (!allowed)
        {
            return BadRequest(error);
        }

        var desiredRaw = request?.Path;
        string desired;
        try
        {
            desired = string.IsNullOrWhiteSpace(desiredRaw)
                ? NormalizeVirtualPath(session.RootPath)
                : NormalizeVirtualPath(desiredRaw);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }

        var root = NormalizeVirtualPath(session.RootPath);
        if (!IsWithinRoot(root, desired))
        {
            return BadRequest("Requested path is outside the allowlisted root.");
        }

        var payload = JsonSerializer.Serialize(new
        {
            path = desired
        });

        var cmd = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            CommandType = CommandType.FileList,
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
            return BadRequest(new FileListResponse(
                SessionId: sessionId,
                NodeId: nodeId,
                Path: desired,
                Entries: Array.Empty<FileBrowserEntry>(),
                CommandId: completed.Id,
                Status: completed.Status.ToString(),
                Error: completed.OutputLog));
        }

        var output = completed.OutputLog ?? "[]";
        List<FileBrowserEntry>? entries;
        try
        {
            entries = JsonSerializer.Deserialize(output, ManLabJsonContext.Default.ListFileBrowserEntry);
        }
        catch (JsonException)
        {
            return BadRequest(new FileListResponse(
                SessionId: sessionId,
                NodeId: nodeId,
                Path: desired,
                Entries: Array.Empty<FileBrowserEntry>(),
                CommandId: completed.Id,
                Status: "Failed",
                Error: "Agent returned malformed JSON."));
        }

        return Ok(new FileListResponse(
            SessionId: sessionId,
            NodeId: nodeId,
            Path: desired,
            Entries: (entries ?? new List<FileBrowserEntry>()).ToArray(),
            CommandId: completed.Id,
            Status: completed.Status.ToString(),
            Error: null));
    }

    [HttpPost("/api/devices/{nodeId:guid}/file-browser-sessions/{sessionId:guid}/read")]
    public async Task<ActionResult<FileReadResponse>> Read(Guid nodeId, Guid sessionId, [FromBody] FileReadRequest request)
    {
        if (!_sessions.TryGet(sessionId, out var session) || session is null)
        {
            return NotFound("Session not found or expired.");
        }

        if (session.NodeId != nodeId)
        {
            return BadRequest("Session does not belong to this node.");
        }

        if (string.IsNullOrWhiteSpace(request.Path))
        {
            return BadRequest("path is required");
        }

        // Ensure node exists
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId);
        if (!nodeExists)
        {
            return NotFound("Node not found.");
        }

        // Authorization check: verify file browser is enabled on this node
        var (allowed, error) = await _authorization.AuthorizeFileBrowserAsync(nodeId);
        if (!allowed)
        {
            return BadRequest(error);
        }

        string desired;
        try
        {
            desired = NormalizeVirtualPath(request.Path);
        }
        catch (ArgumentException ex)
        {
            return BadRequest(ex.Message);
        }

        var root = NormalizeVirtualPath(session.RootPath);
        if (!IsWithinRoot(root, desired))
        {
            return BadRequest("Requested path is outside the allowlisted root.");
        }

        var effectiveMax = request.MaxBytes ?? session.MaxBytesPerRead;
        effectiveMax = Math.Clamp(effectiveMax, 1, session.MaxBytesPerRead);

        var payload = JsonSerializer.Serialize(new
        {
            path = desired,
            maxBytes = effectiveMax
        });

        var cmd = new CommandQueueItem
        {
            Id = Guid.NewGuid(),
            NodeId = nodeId,
            CommandType = CommandType.FileRead,
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
            return BadRequest(new FileReadResponse(
                SessionId: sessionId,
                NodeId: nodeId,
                Path: desired,
                Result: null,
                CommandId: completed.Id,
                Status: completed.Status.ToString(),
                Error: completed.OutputLog));
        }

        var output = completed.OutputLog ?? "{}";
        FileReadResult? result;
        try
        {
            result = JsonSerializer.Deserialize(output, ManLabJsonContext.Default.FileReadResult);
        }
        catch (JsonException)
        {
            return BadRequest(new FileReadResponse(
                SessionId: sessionId,
                NodeId: nodeId,
                Path: desired,
                Result: null,
                CommandId: completed.Id,
                Status: "Failed",
                Error: "Agent returned malformed JSON."));
        }

        return Ok(new FileReadResponse(
            SessionId: sessionId,
            NodeId: nodeId,
            Path: desired,
            Result: result,
            CommandId: completed.Id,
            Status: completed.Status.ToString(),
            Error: null));
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

    public sealed record FileListRequest(string? Path);

    public sealed record FileListResponse(
        Guid SessionId,
        Guid NodeId,
        string Path,
        FileBrowserEntry[] Entries,
        Guid CommandId,
        string Status,
        string? Error);

    public sealed record FileReadRequest(string Path, int? MaxBytes);

    public sealed record FileReadResponse(
        Guid SessionId,
        Guid NodeId,
        string Path,
        FileReadResult? Result,
        Guid CommandId,
        string Status,
        string? Error);

    private static bool IsWithinRoot(string root, string path)
    {
        root = NormalizeVirtualPath(root);
        path = NormalizeVirtualPath(path);

        if (root == "/") return true;
        if (string.Equals(path, root, StringComparison.Ordinal)) return true;
        return path.StartsWith(root + "/", StringComparison.Ordinal);
    }

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
        if (joined.Length > 1 && joined.EndsWith("/", StringComparison.Ordinal))
        {
            joined = joined.TrimEnd('/');
        }

        return string.IsNullOrEmpty(joined) ? "/" : joined;
    }
}
