using System.Text;
using System.Text.Json;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using ManLab.Server.Hubs;
using ManLab.Server.Services.Agents;
using ManLab.Server.Services.Enhancements;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Controllers.Enhancements;

/// <summary>
/// Controller for file download operations with progress tracking.
/// Supports single file downloads and multi-file zip downloads.
/// Uses in-memory streaming via SignalR for efficient large file transfers.
/// </summary>
[ApiController]
public sealed class FileDownloadController : ControllerBase
{
    private static readonly TimeSpan DefaultWaitTimeout = TimeSpan.FromSeconds(30);
    private const int PollDelayMs = 150;

    private readonly DataContext _db;
    private readonly FileBrowserSessionService _fileBrowserSessions;
    private readonly DownloadSessionService _downloadSessions;
    private readonly FileStreamingService _fileStreaming;
    private readonly RemoteToolsAuthorizationService _authorization;
    private readonly AgentConnectionRegistry _registry;
    private readonly IHubContext<AgentHub> _hubContext;
    private readonly ILogger<FileDownloadController> _logger;

    public FileDownloadController(
        DataContext db,
        FileBrowserSessionService fileBrowserSessions,
        DownloadSessionService downloadSessions,
        FileStreamingService fileStreaming,
        RemoteToolsAuthorizationService authorization,
        AgentConnectionRegistry registry,
        IHubContext<AgentHub> hubContext,
        ILogger<FileDownloadController> logger)
    {
        _db = db;
        _fileBrowserSessions = fileBrowserSessions;
        _downloadSessions = downloadSessions;
        _fileStreaming = fileStreaming;
        _authorization = authorization;
        _registry = registry;
        _hubContext = hubContext;
        _logger = logger;
    }

    /// <summary>
    /// Creates a new download session for a single file or zip archive.
    /// </summary>
    /// <param name="nodeId">The target node ID.</param>
    /// <param name="request">The download request containing session ID and paths.</param>
    /// <returns>Download session information including the download ID.</returns>
    [HttpPost("/api/devices/{nodeId:guid}/downloads")]
    public async Task<ActionResult<CreateDownloadResponse>> CreateDownload(
        Guid nodeId,
        [FromBody] CreateDownloadRequest request)
    {
        if (request is null)
        {
            return BadRequest("Request body is required.");
        }

        if (string.IsNullOrWhiteSpace(request.SessionId))
        {
            return BadRequest("sessionId is required.");
        }

        if (!Guid.TryParse(request.SessionId, out var sessionId))
        {
            return BadRequest("sessionId must be a valid GUID.");
        }

        if (request.Paths is null || request.Paths.Length == 0)
        {
            return BadRequest("At least one path is required.");
        }

        // Validate file browser session
        if (!_fileBrowserSessions.TryGet(sessionId, out var fbSession) || fbSession is null)
        {
            return NotFound("File browser session not found or expired.");
        }

        if (fbSession.NodeId != nodeId)
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

        // Validate and normalize all paths
        var normalizedPaths = new List<string>();
        var root = NormalizeVirtualPath(fbSession.RootPath);

        foreach (var path in request.Paths)
        {
            if (string.IsNullOrWhiteSpace(path))
            {
                continue;
            }

            string normalized;
            try
            {
                normalized = NormalizeVirtualPath(path);
            }
            catch (ArgumentException ex)
            {
                return BadRequest($"Invalid path '{path}': {ex.Message}");
            }

            if (!IsWithinRoot(root, normalized))
            {
                return BadRequest($"Path '{path}' is outside the allowlisted root.");
            }

            normalizedPaths.Add(normalized);
        }

        if (normalizedPaths.Count == 0)
        {
            return BadRequest("No valid paths provided.");
        }

        // Determine download type and filename
        var asZip = request.AsZip ?? normalizedPaths.Count > 1;
        var filename = GenerateFilename(normalizedPaths, asZip);

        // Get client connection ID from request context for progress forwarding
        var clientConnectionId = HttpContext.Request.Headers["X-SignalR-ConnectionId"].FirstOrDefault();

        // Create download session
        var downloadSession = _downloadSessions.CreateSession(
            nodeId: nodeId,
            fileBrowserSessionId: request.SessionId,
            paths: normalizedPaths.ToArray(),
            asZip: asZip,
            filename: filename,
            requestedBy: HttpContext.User?.Identity?.Name,
            clientConnectionId: clientConnectionId);

        // Dispatch command to agent
        if (asZip)
        {
            // Dispatch file.zip command
            var zipPayload = new FileZipPayload
            {
                DownloadId = downloadSession.Id,
                Paths = normalizedPaths.ToArray(),
                MaxUncompressedBytes = 1024 * 1024 * 1024, // 1GB default
                MaxFileCount = 10_000
            };

            var payloadJson = JsonSerializer.Serialize(zipPayload, ManLabJsonContext.Default.FileZipPayload);

            var cmd = new CommandQueueItem
            {
                Id = Guid.NewGuid(),
                NodeId = nodeId,
                CommandType = CommandType.FileZip,
                Payload = payloadJson,
                Status = CommandStatus.Queued,
                CreatedAt = DateTime.UtcNow
            };

            _db.CommandQueue.Add(cmd);
            await _db.SaveChangesAsync();

            // Best-effort: dispatch immediately if the agent is currently connected
            await TryDispatchNowAsync(nodeId, cmd.Id, CommandTypes.FileZip, payloadJson);

            _logger.LogInformation(
                "Created zip download session {DownloadId} for node {NodeId}, paths: {PathCount}",
                downloadSession.Id, nodeId, normalizedPaths.Count);
        }
        else
        {
            // Single file download - dispatch file.read command to get file info first
            var readPayload = new FileReadPayload
            {
                Path = normalizedPaths[0],
                MaxBytes = 0, // Just get file info, no content
                Offset = 0
            };

            var payloadJson = JsonSerializer.Serialize(readPayload, ManLabJsonContext.Default.FileReadPayload);

            var cmd = new CommandQueueItem
            {
                Id = Guid.NewGuid(),
                NodeId = nodeId,
                CommandType = CommandType.FileRead,
                Payload = payloadJson,
                Status = CommandStatus.Queued,
                CreatedAt = DateTime.UtcNow
            };

            _db.CommandQueue.Add(cmd);
            await _db.SaveChangesAsync();

            // Best-effort: dispatch immediately if the agent is currently connected
            await TryDispatchNowAsync(nodeId, cmd.Id, CommandTypes.FileRead, payloadJson);

            _logger.LogInformation(
                "Created single file download session {DownloadId} for node {NodeId}, path: {Path}",
                downloadSession.Id, nodeId, normalizedPaths[0]);
        }

        // Update session status to preparing
        _downloadSessions.UpdateStatus(downloadSession.Id, DownloadSessionService.DownloadStatus.Preparing);

        return Ok(new CreateDownloadResponse
        {
            DownloadId = downloadSession.Id.ToString(),
            Filename = filename,
            TotalBytes = null, // Will be updated when agent responds
            Status = "Preparing"
        });
    }

    /// <summary>
    /// Streams the download content to the client.
    /// Uses chunked transfer encoding for large files.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <returns>The file content as a stream.</returns>
    [HttpGet("/api/downloads/{downloadId:guid}/stream")]
    public async Task<IActionResult> StreamDownload(Guid downloadId)
    {
        if (!_downloadSessions.TryGetSession(downloadId, out var session) || session is null)
        {
            return NotFound("Download session not found or expired.");
        }

        // Check if agent is connected
        if (!_registry.TryGet(session.NodeId, out var connectionId))
        {
            _downloadSessions.CompleteSession(downloadId, false, "Agent is not connected.");
            return StatusCode(503, "Agent is not connected.");
        }

        // Set response headers
        var sanitizedFilename = SanitizeFilename(session.Filename);
        Response.Headers.ContentDisposition = $"attachment; filename=\"{sanitizedFilename}\"";
        Response.ContentType = session.AsZip ? "application/zip" : "application/octet-stream";

        if (session.TotalBytes.HasValue && session.TotalBytes.Value > 0)
        {
            Response.Headers.ContentLength = session.TotalBytes.Value;
        }

        try
        {
            // For single file downloads, we need to stream chunks from the agent
            if (!session.AsZip)
            {
                // Transition to downloading immediately for single-file streams.
                _downloadSessions.UpdateStatus(downloadId, DownloadSessionService.DownloadStatus.Downloading);
                await StreamSingleFileAsync(session, connectionId, session.CancellationSource.Token);
            }
            else
            {
                // For zip downloads, the agent creates a temp file and we stream it
                await StreamZipFileAsync(session, connectionId, session.CancellationSource.Token);
            }

            _downloadSessions.CompleteSession(downloadId, true);
            return new EmptyResult();
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Download {DownloadId} was cancelled", downloadId);
            _downloadSessions.CompleteSession(downloadId, false, "Download was cancelled.");

            // If we've already started streaming bytes, we can't change the status code anymore.
            if (Response.HasStarted)
            {
                HttpContext.Abort();
                return new EmptyResult();
            }

            return StatusCode(499, "Download was cancelled.");
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error streaming download {DownloadId}", downloadId);
            _downloadSessions.CompleteSession(downloadId, false, ex.Message);

            // If the response has started, the only safe option is to abort the connection.
            // Returning a StatusCode/ObjectResult would throw "StatusCode cannot be set because the response has already started".
            if (Response.HasStarted)
            {
                HttpContext.Abort();
                return new EmptyResult();
            }

            return StatusCode(500, $"Error streaming download: {ex.Message}");
        }
    }

    /// <summary>
    /// Cancels an active download.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <returns>Success status.</returns>
    [HttpDelete("/api/downloads/{downloadId:guid}")]
    public async Task<ActionResult> CancelDownload(Guid downloadId)
    {
        if (!_downloadSessions.TryGetSession(downloadId, out var session) || session is null)
        {
            return NotFound("Download session not found or expired.");
        }

        // Cancel the session
        _downloadSessions.CancelSession(downloadId);

        // Notify agent to stop transfer if connected
        if (_registry.TryGet(session.NodeId, out var connectionId))
        {
            try
            {
                var cancelPayload = new CancelCommandPayload
                {
                    TargetCommandId = downloadId
                };

                var payloadJson = JsonSerializer.Serialize(cancelPayload, ManLabJsonContext.Default.CancelCommandPayload);

                await _hubContext.Clients.Client(connectionId)
                    .SendAsync("ExecuteCommand", Guid.NewGuid(), CommandTypes.CommandCancel, payloadJson);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to notify agent about download cancellation {DownloadId}", downloadId);
            }
        }

        _logger.LogInformation("Download {DownloadId} cancelled", downloadId);

        return Ok(new { message = "Download cancelled." });
    }

    private async Task StreamSingleFileAsync(
        DownloadSessionService.DownloadSession session,
        string connectionId,
        CancellationToken cancellationToken)
    {
        var path = session.Paths[0];

        // Create an in-memory streaming session
        var streamingSession = _fileStreaming.CreateSession(
            session.Id,
            session.NodeId,
            session.TotalBytes ?? 0);

        try
        {
            // Dispatch file.stream command to agent
            var streamPayload = new FileStreamPayload
            {
                DownloadId = session.Id,
                Path = path,
                ChunkSize = 256 * 1024 // 256KB chunks for efficient streaming
            };

            var payloadJson = JsonSerializer.Serialize(streamPayload, ManLabJsonContext.Default.FileStreamPayload);

            // Send stream command to agent
            await _hubContext.Clients.Client(connectionId)
                .SendAsync("ExecuteCommand", Guid.NewGuid(), CommandTypes.FileStream, payloadJson, cancellationToken);

            _logger.LogInformation(
                "Initiated file streaming for download {DownloadId}, file: {Path}",
                session.Id, path);

            // Read chunks from the streaming channel and write to HTTP response
            long bytesWritten = 0;
            bool headersSent = false;

            await foreach (var chunk in streamingSession.Reader.ReadAllAsync(cancellationToken))
            {
                // Set Content-Length on first chunk if we have total bytes
                if (!headersSent && streamingSession.TotalBytes > 0 && !Response.HasStarted)
                {
                    Response.Headers.ContentLength = streamingSession.TotalBytes;
                    _downloadSessions.SetTotalBytes(session.Id, streamingSession.TotalBytes);
                }
                headersSent = true;

                await Response.Body.WriteAsync(chunk, cancellationToken);
                bytesWritten += chunk.Length;

                // Update progress
                _downloadSessions.UpdateProgress(session.Id, bytesWritten, streamingSession.TotalBytes);
            }

            // Check for errors
            if (!string.IsNullOrEmpty(streamingSession.Error))
            {
                throw new InvalidOperationException(streamingSession.Error);
            }

            _logger.LogInformation(
                "File streaming completed for download {DownloadId}, {BytesWritten} bytes written",
                session.Id, bytesWritten);
        }
        finally
        {
            // Clean up the streaming session
            _fileStreaming.RemoveSession(session.Id);
        }
    }

    private async Task StreamZipFileAsync(
        DownloadSessionService.DownloadSession session,
        string connectionId,
        CancellationToken cancellationToken)
    {
        // For zip downloads, we need to wait for the zip creation to complete
        // then stream the resulting file
        // The agent will report progress via SignalR as it creates the zip

        // Wait for the zip to be ready (agent will update session status)
        var deadline = DateTime.UtcNow.Add(TimeSpan.FromMinutes(10)); // 10 minute timeout for zip creation

        while (DateTime.UtcNow < deadline && !cancellationToken.IsCancellationRequested)
        {
            if (!_downloadSessions.TryGetSession(session.Id, out var currentSession) || currentSession is null)
            {
                throw new InvalidOperationException("Download session was removed.");
            }

            if (currentSession.Status == DownloadSessionService.DownloadStatus.Failed)
            {
                throw new InvalidOperationException(currentSession.Error ?? "Zip creation failed.");
            }

            if (currentSession.Status == DownloadSessionService.DownloadStatus.Cancelled)
            {
                throw new OperationCanceledException("Download was cancelled.");
            }

            // Check if zip is ready (agent will have set TotalBytes and TempFilePath when zip is complete)
            if (currentSession.TotalBytes.HasValue && currentSession.TotalBytes.Value > 0 
                && !string.IsNullOrEmpty(currentSession.TempFilePath))
            {
                // Zip is ready, stream it
                await StreamZipContentAsync(currentSession, connectionId, cancellationToken);
                return;
            }

            await Task.Delay(PollDelayMs, cancellationToken);
        }

        throw new TimeoutException("Timed out waiting for zip creation.");
    }

    private async Task StreamZipContentAsync(
        DownloadSessionService.DownloadSession session,
        string connectionId,
        CancellationToken cancellationToken)
    {
        // Now that we're actually streaming bytes, transition to downloading.
        _downloadSessions.UpdateStatus(session.Id, DownloadSessionService.DownloadStatus.Downloading);

        // Use the temp file path stored in the session after zip creation
        if (string.IsNullOrEmpty(session.TempFilePath))
        {
            throw new InvalidOperationException("Zip file path not available. The agent may not have reported the temp file path.");
        }

        // Set Content-Length now that we know the zip size (if not already set)
        if (session.TotalBytes.HasValue && session.TotalBytes.Value > 0 && !Response.HasStarted)
        {
            Response.Headers.ContentLength = session.TotalBytes.Value;
        }

        // Create an in-memory streaming session
        var streamingSession = _fileStreaming.CreateSession(
            session.Id,
            session.NodeId,
            session.TotalBytes ?? 0);

        try
        {
            // Dispatch file.stream command to agent
            var streamPayload = new FileStreamPayload
            {
                DownloadId = session.Id,
                Path = session.TempFilePath,
                ChunkSize = 256 * 1024 // 256KB chunks for efficient streaming
            };

            var payloadJson = JsonSerializer.Serialize(streamPayload, ManLabJsonContext.Default.FileStreamPayload);

            // Send stream command to agent (don't need to store in DB - this is fire-and-forget)
            await _hubContext.Clients.Client(connectionId)
                .SendAsync("ExecuteCommand", Guid.NewGuid(), CommandTypes.FileStream, payloadJson, cancellationToken);

            _logger.LogInformation(
                "Initiated file streaming for download {DownloadId}, file: {TempFilePath}",
                session.Id, session.TempFilePath);

            // Read chunks from the streaming channel and write to HTTP response
            long bytesWritten = 0;
            await foreach (var chunk in streamingSession.Reader.ReadAllAsync(cancellationToken))
            {
                await Response.Body.WriteAsync(chunk, cancellationToken);
                bytesWritten += chunk.Length;

                // Update progress
                _downloadSessions.UpdateProgress(session.Id, bytesWritten, streamingSession.TotalBytes);
            }

            // Check for errors
            if (!string.IsNullOrEmpty(streamingSession.Error))
            {
                throw new InvalidOperationException(streamingSession.Error);
            }

            _logger.LogInformation(
                "File streaming completed for download {DownloadId}, {BytesWritten} bytes written",
                session.Id, bytesWritten);
        }
        finally
        {
            // Clean up the streaming session
            _fileStreaming.RemoveSession(session.Id);
        }
    }

    private async Task<CommandQueueItem?> WaitForCompletionAsync(
        Guid commandId,
        TimeSpan timeout,
        CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow.Add(timeout);

        while (DateTime.UtcNow < deadline && !cancellationToken.IsCancellationRequested)
        {
            var cmd = await _db.CommandQueue
                .AsNoTracking()
                .FirstOrDefaultAsync(c => c.Id == commandId, cancellationToken);

            if (cmd is null)
            {
                return null;
            }

            if (cmd.Status is CommandStatus.Success or CommandStatus.Failed)
            {
                return cmd;
            }

            await Task.Delay(PollDelayMs, cancellationToken);
        }

        return null;
    }

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

    private static string GenerateFilename(List<string> paths, bool asZip)
    {
        if (paths.Count == 1 && !asZip)
        {
            // Single file - use the original filename
            var path = paths[0];
            var lastSlash = path.LastIndexOf('/');
            return lastSlash >= 0 ? path[(lastSlash + 1)..] : path;
        }

        // Multiple files or zip - generate a descriptive name
        if (paths.Count == 1)
        {
            var path = paths[0];
            var lastSlash = path.LastIndexOf('/');
            var name = lastSlash >= 0 ? path[(lastSlash + 1)..] : path;
            return $"{name}.zip";
        }

        return $"download_{DateTime.UtcNow:yyyyMMdd_HHmmss}.zip";
    }

    private static string SanitizeFilename(string filename)
    {
        // Remove or replace characters that are unsafe for Content-Disposition header
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(filename
            .Select(c => invalidChars.Contains(c) ? '_' : c)
            .ToArray());

        // Also escape quotes and backslashes
        sanitized = sanitized.Replace("\"", "_").Replace("\\", "_");

        // Limit length
        if (sanitized.Length > 200)
        {
            var ext = Path.GetExtension(sanitized);
            sanitized = sanitized[..(200 - ext.Length)] + ext;
        }

        return sanitized;
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

    /// <summary>
    /// Request to create a new download.
    /// </summary>
    public sealed record CreateDownloadRequest
    {
        /// <summary>The file browser session ID.</summary>
        public string SessionId { get; init; } = string.Empty;

        /// <summary>The paths to download.</summary>
        public string[] Paths { get; init; } = [];

        /// <summary>Whether to create a zip archive (default: auto-detect based on path count).</summary>
        public bool? AsZip { get; init; }
    }

    /// <summary>
    /// Response from creating a download.
    /// </summary>
    public sealed record CreateDownloadResponse
    {
        /// <summary>The unique download session ID.</summary>
        public string DownloadId { get; init; } = string.Empty;

        /// <summary>The output filename.</summary>
        public string Filename { get; init; } = string.Empty;

        /// <summary>Total bytes to download (null if not yet known).</summary>
        public long? TotalBytes { get; init; }

        /// <summary>Current download status.</summary>
        public string Status { get; init; } = string.Empty;
    }
}
