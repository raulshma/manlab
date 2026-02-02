using System.Text.Json;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Agents;
using ManLab.Server.Services.Enhancements;
using ManLab.Shared.Dtos;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.SignalR;

namespace ManLab.Server.Controllers.Enhancements;

/// <summary>
/// Remote file browser endpoints backed by short-lived sessions.
///
/// These endpoints validate against server-side allowlist policies, enqueue bounded commands
/// (file.list/file.read) to the target agent, and return the resulting content.
/// Server-side authorization checks are performed before dispatching commands.
/// </summary>
[ApiController]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.FileBrowserView)]
public sealed class FileBrowserController : ControllerBase
{
    private static readonly TimeSpan DefaultWaitTimeout = TimeSpan.FromSeconds(10);
    private const int PollDelayMs = 150;

    // Keep file browser command outputs below the server's bounded OutputLog tail sizes.
    // The DB interceptor currently truncates CommandQueueItem.OutputLog to 64 KiB.
    private const int DefaultMaxEntries = 5_000;
    private const int MaxEntriesUpperBound = 50_000;
    private const int TransportSafeMaxReadBytesPerRequest = 32 * 1024;

    private readonly DataContext _db;
    private readonly FileBrowserSessionService _sessions;
    private readonly RemoteToolsAuthorizationService _authorization;
    private readonly AgentConnectionRegistry _registry;
    private readonly IHubContext<AgentHub> _hubContext;

    public FileBrowserController(
        DataContext db,
        FileBrowserSessionService sessions,
        RemoteToolsAuthorizationService authorization,
        AgentConnectionRegistry registry,
        IHubContext<AgentHub> hubContext)
    {
        _db = db;
        _sessions = sessions;
        _authorization = authorization;
        _registry = registry;
        _hubContext = hubContext;
    }

    [HttpPost("/api/devices/{nodeId:guid}/file-browser-sessions/{sessionId:guid}/list")]
    public async Task<ActionResult<FileListResponse>> List(Guid nodeId, Guid sessionId, [FromBody] FileListRequest? request)
    {
        var (sessionFound, session) = await _sessions.TryGetAsync(sessionId);
        if (!sessionFound || session is null)
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

        var requestedMaxEntries = request?.MaxEntries;
        var effectiveMaxEntries = requestedMaxEntries ?? DefaultMaxEntries;
        effectiveMaxEntries = Math.Clamp(effectiveMaxEntries, 1, MaxEntriesUpperBound);

        var payload = JsonSerializer.Serialize(new FileListPayload
        {
            Path = desired,
            MaxEntries = effectiveMaxEntries
        }, ManLabJsonContext.Default.FileListPayload);

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

        // Best-effort: dispatch immediately if the agent is currently connected.
        await TryDispatchNowAsync(nodeId, cmd.Id, CommandTypes.FileList, payload).ConfigureAwait(false);

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
                Truncated: false,
                CommandId: completed.Id,
                Status: completed.Status.ToString(),
                Error: completed.OutputLog));
        }

        var output = completed.OutputLog ?? "{}";

        // New format: FileListResult { entries, truncated }
        // Back-compat: some older agents may return a raw array of FileBrowserEntry.
        FileBrowserEntry[] entries;
        var truncated = false;
        try
        {
            // Try new format first.
            var listResult = JsonSerializer.Deserialize(output, ManLabJsonContext.Default.FileListResult);
            if (listResult is not null)
            {
                entries = (listResult.Entries ?? Array.Empty<FileBrowserEntry>()).ToArray();
                truncated = listResult.Truncated;
            }
            else
            {
                entries = Array.Empty<FileBrowserEntry>();
            }
        }
        catch (JsonException)
        {
            try
            {
                var legacy = JsonSerializer.Deserialize(output, ManLabJsonContext.Default.ListFileBrowserEntry) ?? new List<FileBrowserEntry>();
                entries = legacy.ToArray();
                truncated = false;
            }
            catch (JsonException)
            {
                return BadRequest(new FileListResponse(
                    SessionId: sessionId,
                    NodeId: nodeId,
                    Path: desired,
                    Entries: Array.Empty<FileBrowserEntry>(),
                    Truncated: false,
                    CommandId: completed.Id,
                    Status: "Failed",
                    Error: "Agent returned malformed JSON."));
            }
        }

        return Ok(new FileListResponse(
            SessionId: sessionId,
            NodeId: nodeId,
            Path: desired,
            Entries: entries,
            Truncated: truncated,
            CommandId: completed.Id,
            Status: completed.Status.ToString(),
            Error: null));
    }

    [HttpPost("/api/devices/{nodeId:guid}/file-browser-sessions/{sessionId:guid}/read")]
    public async Task<ActionResult<FileReadResponse>> Read(Guid nodeId, Guid sessionId, [FromBody] FileReadRequest request)
    {
        var (sessionFound, session) = await _sessions.TryGetAsync(sessionId);
        if (!sessionFound || session is null)
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

        var requestedOffset = request.Offset ?? 0;
        if (requestedOffset < 0)
        {
            return BadRequest("offset must be >= 0");
        }

        var effectiveMax = request.MaxBytes ?? session.MaxBytesPerRead;
        effectiveMax = Math.Clamp(effectiveMax, 1, session.MaxBytesPerRead);
        effectiveMax = Math.Min(effectiveMax, TransportSafeMaxReadBytesPerRequest);

        var payload = JsonSerializer.Serialize(new FileReadPayload
        {
            Path = desired,
            MaxBytes = effectiveMax,
            Offset = requestedOffset
        }, ManLabJsonContext.Default.FileReadPayload);

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

        // Best-effort: dispatch immediately if the agent is currently connected.
        await TryDispatchNowAsync(nodeId, cmd.Id, CommandTypes.FileRead, payload).ConfigureAwait(false);

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

    public sealed record FileListRequest(string? Path, int? MaxEntries);

    public sealed record FileListResponse(
        Guid SessionId,
        Guid NodeId,
        string Path,
        FileBrowserEntry[] Entries,
        bool Truncated,
        Guid CommandId,
        string Status,
        string? Error);

    public sealed record FileReadRequest(string Path, int? MaxBytes, long? Offset);

    public sealed record FileReadResponse(
        Guid SessionId,
        Guid NodeId,
        string Path,
        FileReadResult? Result,
        Guid CommandId,
        string Status,
        string? Error);

    private async Task TryDispatchNowAsync(Guid nodeId, Guid commandId, string commandType, string payload)
    {
        if (!_registry.TryGet(nodeId, out var connectionId))
        {
            return;
        }

        try
        {
            await _hubContext.Clients.Client(connectionId)
                .SendAsync("ExecuteCommand", commandId, commandType, payload)
                .ConfigureAwait(false);
        }
        catch
        {
            // Best-effort only. DispatchService will retry.
        }
    }

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
