using System.Buffers;
using System.Net;
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
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace ManLab.Server.Controllers.Enhancements;

/// <summary>
/// High-performance file download controller optimized for huge files.
/// 
/// Architecture:
/// - Uses HTTP streaming for actual file data (not SignalR) for maximum throughput
/// - Supports Range requests for resumable downloads
/// - Uses bounded channels with backpressure to prevent memory exhaustion
/// - Optimized for multi-gigabyte file transfers
/// - SignalR is only used for control messages (start/stop/progress) not data
/// </summary>
[ApiController]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.FileBrowserView)]
public sealed class FileDownloadController : ControllerBase
{
    // Performance configuration
    private const int DefaultChunkSize = 1024 * 1024; // 1MB chunks
    private const int MaxChunkSize = 4 * 1024 * 1024; // 4MB max
    private const int ResponseBufferSize = 64 * 1024; // 64KB response buffer
    private static readonly TimeSpan StreamingTimeout = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan ZipCreationTimeout = TimeSpan.FromHours(2);
    private static readonly TimeSpan FirstChunkTimeout = TimeSpan.FromSeconds(60);

    private readonly DataContext _db;
    private readonly FileBrowserSessionService _fileBrowserSessions;
    private readonly DownloadSessionService _downloadSessions;
    private readonly StreamingDownloadService _streamingDownloads;
    private readonly RemoteToolsAuthorizationService _authorization;
    private readonly AgentConnectionRegistry _registry;
    private readonly IHubContext<AgentHub> _hubContext;
    private readonly ILogger<FileDownloadController> _logger;

    public FileDownloadController(
        DataContext db,
        FileBrowserSessionService fileBrowserSessions,
        DownloadSessionService downloadSessions,
        StreamingDownloadService streamingDownloads,
        RemoteToolsAuthorizationService authorization,
        AgentConnectionRegistry registry,
        IHubContext<AgentHub> hubContext,
        ILogger<FileDownloadController> logger)
    {
        _db = db;
        _fileBrowserSessions = fileBrowserSessions;
        _downloadSessions = downloadSessions;
        _streamingDownloads = streamingDownloads;
        _authorization = authorization;
        _registry = registry;
        _hubContext = hubContext;
        _logger = logger;
    }

    /// <summary>
    /// Creates a new download session for single file or zip archive.
    /// Returns immediately with session ID for polling/streaming.
    /// </summary>
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
        var (fbSessionFound, fbSession) = await _fileBrowserSessions.TryGetAsync(sessionId);
        if (!fbSessionFound || fbSession is null)
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

        // Authorization check
        var (allowed, error) = await _authorization.AuthorizeFileBrowserAsync(nodeId);
        if (!allowed)
        {
            return BadRequest(error);
        }

        // Validate and normalize paths
        var normalizedPaths = NormalizePaths(request.Paths, fbSession.RootPath, out var pathError);
        if (pathError is not null)
        {
            return BadRequest(pathError);
        }

        if (normalizedPaths.Count == 0)
        {
            return BadRequest("No valid paths provided.");
        }

        // Determine download type
        var asZip = request.AsZip ?? normalizedPaths.Count > 1;
        var filename = GenerateFilename(normalizedPaths, asZip);

        // Get client connection ID for progress updates
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

        // For zip downloads, dispatch file.zip command to agent
        if (asZip)
        {
            await DispatchZipCommandAsync(nodeId, downloadSession.Id, normalizedPaths);
        }

        _downloadSessions.UpdateStatus(downloadSession.Id, DownloadSessionService.DownloadStatus.Preparing);

        _logger.LogInformation(
            "Created download session {DownloadId} for node {NodeId}, paths: {PathCount}, asZip: {AsZip}",
            downloadSession.Id, nodeId, normalizedPaths.Count, asZip);

        return Ok(new CreateDownloadResponse
        {
            DownloadId = downloadSession.Id.ToString(),
            Filename = filename,
            AsZip = asZip,
            PathCount = normalizedPaths.Count,
            Status = "Preparing",
            StreamUrl = Url.Action(nameof(StreamDownload), new { downloadId = downloadSession.Id })!
        });
    }

    /// <summary>
    /// Streams the download content directly to the client.
    /// Supports Range requests for resumable downloads.
    /// Optimized for huge files with streaming and backpressure.
    /// </summary>
    [HttpGet("/api/downloads/{downloadId:guid}/stream")]
    public async Task StreamDownload(Guid downloadId)
    {
        if (!_downloadSessions.TryGetSession(downloadId, out var session) || session is null)
        {
            Response.StatusCode = (int)HttpStatusCode.NotFound;
            await Response.WriteAsync("Download session not found or expired.");
            return;
        }

        // Check if agent is connected
        if (!_registry.TryGet(session.NodeId, out var connectionId))
        {
            _downloadSessions.CompleteSession(downloadId, false, "Agent is not connected.");
            Response.StatusCode = (int)HttpStatusCode.ServiceUnavailable;
            await Response.WriteAsync("Agent is not connected.");
            return;
        }

        // For zip downloads, wait for zip creation to complete
        if (session.AsZip)
        {
            var waitResult = await WaitForZipReadyAsync(session, session.CancellationSource.Token);
            if (!waitResult.Success)
            {
                Response.StatusCode = waitResult.StatusCode;
                await Response.WriteAsync(waitResult.Error ?? "Failed to prepare download.");
                return;
            }
        }

        // Parse Range header for resumable downloads
        var rangeHeader = Request.Headers.Range.FirstOrDefault();
        var (startOffset, endOffset, isPartial) = ParseRangeHeader(rangeHeader, session.TotalBytes ?? 0);

        // Set response headers
        SetDownloadHeaders(session, startOffset, endOffset, isPartial);

        try
        {
            await StreamFileContentAsync(
                session,
                connectionId,
                startOffset,
                endOffset,
                session.CancellationSource.Token);

            _downloadSessions.CompleteSession(downloadId, true);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("Download {DownloadId} was cancelled", downloadId);
            _downloadSessions.CompleteSession(downloadId, false, "Cancelled.");

            if (!Response.HasStarted)
            {
                Response.StatusCode = 499; // Client closed request
            }
            else
            {
                HttpContext.Abort();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error streaming download {DownloadId}", downloadId);
            _downloadSessions.CompleteSession(downloadId, false, ex.Message);

            if (!Response.HasStarted)
            {
                Response.StatusCode = (int)HttpStatusCode.InternalServerError;
                await Response.WriteAsync($"Streaming error: {ex.Message}");
            }
            else
            {
                HttpContext.Abort();
            }
        }
    }

    /// <summary>
    /// Gets download status and progress information.
    /// </summary>
    [HttpGet("/api/downloads/{downloadId:guid}/status")]
    public ActionResult<DownloadStatusResponse> GetDownloadStatus(Guid downloadId)
    {
        if (!_downloadSessions.TryGetSession(downloadId, out var session) || session is null)
        {
            return NotFound("Download session not found or expired.");
        }

        var elapsed = DateTime.UtcNow - session.CreatedAt;
        var speed = elapsed.TotalSeconds > 0 ? session.TransferredBytes / elapsed.TotalSeconds : 0;

        int? eta = null;
        if (session.TotalBytes.HasValue && session.TotalBytes > 0 && speed > 0)
        {
            var remaining = session.TotalBytes.Value - session.TransferredBytes;
            eta = (int)Math.Ceiling(remaining / speed);
        }

        return Ok(new DownloadStatusResponse
        {
            DownloadId = downloadId.ToString(),
            Status = session.Status.ToString(),
            Filename = session.Filename,
            TotalBytes = session.TotalBytes,
            TransferredBytes = session.TransferredBytes,
            SpeedBytesPerSec = (long)speed,
            EstimatedSecondsRemaining = eta,
            Error = session.Error,
            CreatedAt = session.CreatedAt.ToString("O"),
            CompletedAt = session.CompletedAt?.ToString("O")
        });
    }

    /// <summary>
    /// Cancels an active download.
    /// </summary>
    [HttpDelete("/api/downloads/{downloadId:guid}")]
    public async Task<ActionResult> CancelDownload(Guid downloadId)
    {
        if (!_downloadSessions.TryGetSession(downloadId, out var session) || session is null)
        {
            return NotFound("Download session not found or expired.");
        }

        _downloadSessions.CancelSession(downloadId);
        _streamingDownloads.RemoveDownload(downloadId);

        // Notify agent to stop
        if (_registry.TryGet(session.NodeId, out var connectionId))
        {
            try
            {
                var cancelPayload = new CancelCommandPayload { TargetCommandId = downloadId };
                var payloadJson = JsonSerializer.Serialize(cancelPayload, ManLabJsonContext.Default.CancelCommandPayload);
                await _hubContext.Clients.Client(connectionId)
                    .SendAsync("ExecuteCommand", Guid.NewGuid(), CommandTypes.CommandCancel, payloadJson);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to notify agent about cancellation for {DownloadId}", downloadId);
            }
        }

        return Ok(new { message = "Download cancelled." });
    }

    private async Task StreamFileContentAsync(
        DownloadSessionService.DownloadSession session,
        string connectionId,
        long startOffset,
        long endOffset,
        CancellationToken cancellationToken)
    {
        // Update status to downloading
        _downloadSessions.UpdateStatus(session.Id, DownloadSessionService.DownloadStatus.Downloading);

        // Re-fetch connection ID in case agent reconnected
        if (!_registry.TryGet(session.NodeId, out var currentConnectionId))
        {
            throw new InvalidOperationException("Agent disconnected.");
        }

        // Determine the file path to stream
        string filePath;
        if (session.AsZip)
        {
            // For zip downloads, we must have the temp file path from the agent's FileZip result.
            if (string.IsNullOrEmpty(session.TempFilePath))
            {
                _logger.LogError(
                    "Zip download {DownloadId} has no TempFilePath set. Status: {Status}, TotalBytes: {TotalBytes}",
                    session.Id, session.Status, session.TotalBytes);
                throw new InvalidOperationException(
                    "Zip file path not available. The agent may not have reported the temp file location.");
            }
            filePath = session.TempFilePath;
        }
        else if (session.Paths.Length > 0)
        {
            filePath = session.Paths[0];
        }
        else
        {
            throw new InvalidOperationException("No file path available for streaming.");
        }

        // Create streaming session
        var streamingDownload = _streamingDownloads.CreateDownload(
            session.NodeId,
            filePath,
            session.TotalBytes ?? 0,
            startOffset,
            endOffset);

        try
        {
            // Dispatch streaming command to agent
            var streamPayload = new StreamDownloadPayload
            {
                StreamId = streamingDownload.Id,
                Path = filePath,
                StartOffset = startOffset,
                EndOffset = endOffset,
                ChunkSize = DefaultChunkSize
            };

            var payloadJson = JsonSerializer.Serialize(streamPayload, ManLabJsonContext.Default.StreamDownloadPayload);

            await _hubContext.Clients.Client(currentConnectionId)
                .SendAsync("ExecuteCommand", Guid.NewGuid(), CommandTypes.FileStream, payloadJson, cancellationToken);

            _logger.LogInformation(
                "Started streaming download {DownloadId} from offset {StartOffset}",
                session.Id, startOffset);

            // Wait for first chunk with timeout
            using var firstChunkCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            firstChunkCts.CancelAfter(FirstChunkTimeout);

            try
            {
                var dataAvailable = await streamingDownload.Reader.WaitToReadAsync(firstChunkCts.Token);
                if (!dataAvailable)
                {
                    throw new InvalidOperationException(
                        streamingDownload.Error ?? "Agent completed without sending data.");
                }
            }
            catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
            {
                throw new TimeoutException("Timeout waiting for agent to start streaming.");
            }

            // Stream chunks to response
            long bytesWritten = 0;
            var responseBody = Response.Body;

            await foreach (var chunk in streamingDownload.Reader.ReadAllAsync(cancellationToken))
            {
                await responseBody.WriteAsync(chunk, cancellationToken);
                bytesWritten += chunk.Length;

                // Update progress periodically (every 5 MB to reduce overhead)
                if (bytesWritten % (5 * 1024 * 1024) < chunk.Length)
                {
                    _downloadSessions.UpdateProgress(session.Id, bytesWritten, streamingDownload.TotalBytes);
                }
            }

            // Ensure final flush
            await responseBody.FlushAsync(cancellationToken);

            // Check for errors
            if (!string.IsNullOrEmpty(streamingDownload.Error))
            {
                throw new InvalidOperationException(streamingDownload.Error);
            }

            _logger.LogInformation(
                "Streaming completed for download {DownloadId}, {BytesWritten} bytes written",
                session.Id, bytesWritten);
        }
        finally
        {
            _streamingDownloads.RemoveDownload(streamingDownload.Id);
        }
    }

    private async Task<(bool Success, int StatusCode, string? Error)> WaitForZipReadyAsync(
        DownloadSessionService.DownloadSession session,
        CancellationToken cancellationToken)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        cts.CancelAfter(ZipCreationTimeout);

        var loggedOnce = false;

        try
        {
            while (!cts.Token.IsCancellationRequested)
            {
                if (!_downloadSessions.TryGetSession(session.Id, out var currentSession) || currentSession is null)
                {
                    return (false, 404, "Download session was removed.");
                }

                if (currentSession.Status == DownloadSessionService.DownloadStatus.Failed)
                {
                    return (false, 500, currentSession.Error ?? "Zip creation failed.");
                }

                if (currentSession.Status == DownloadSessionService.DownloadStatus.Cancelled)
                {
                    return (false, 499, "Download was cancelled.");
                }

                // Check if zip is ready - the Ready status is the authoritative indicator.
                // TotalBytes and TempFilePath are both required for streaming.
                if (currentSession.Status == DownloadSessionService.DownloadStatus.Ready &&
                    currentSession.TotalBytes.HasValue && currentSession.TotalBytes > 0 &&
                    !string.IsNullOrEmpty(currentSession.TempFilePath))
                {
                    _logger.LogInformation(
                        "Zip ready for download {DownloadId}: Status={Status}, TotalBytes={TotalBytes}, TempFilePath={TempFilePath}",
                        session.Id, currentSession.Status, currentSession.TotalBytes, currentSession.TempFilePath);
                    return (true, 200, null);
                }

                // Log waiting state once per request for debugging
                if (!loggedOnce)
                {
                    _logger.LogDebug(
                        "Waiting for zip download {DownloadId}: Status={Status}, TotalBytes={TotalBytes}, TempFilePath={TempFilePath}",
                        session.Id, currentSession.Status, currentSession.TotalBytes, currentSession.TempFilePath ?? "(null)");
                    loggedOnce = true;
                }

                await Task.Delay(200, cts.Token);
            }

            return (false, 504, "Timeout waiting for zip creation.");
        }
        catch (OperationCanceledException) when (!cancellationToken.IsCancellationRequested)
        {
            return (false, 504, "Timeout waiting for zip creation.");
        }
    }

    private async Task DispatchZipCommandAsync(Guid nodeId, Guid downloadId, List<string> paths)
    {
        var zipPayload = new FileZipPayload
        {
            DownloadId = downloadId,
            Paths = paths.ToArray(),
            MaxUncompressedBytes = 10L * 1024 * 1024 * 1024, // 10GB
            MaxFileCount = 100_000
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

        // Dispatch immediately if agent connected
        if (_registry.TryGet(nodeId, out var connectionId))
        {
            try
            {
                await _hubContext.Clients.Client(connectionId)
                    .SendAsync("ExecuteCommand", cmd.Id, CommandTypes.FileZip, payloadJson);
            }
            catch
            {
                // Best effort
            }
        }
    }

    private void SetDownloadHeaders(
        DownloadSessionService.DownloadSession session,
        long startOffset,
        long endOffset,
        bool isPartial)
    {
        var sanitizedFilename = SanitizeFilename(session.Filename);

        Response.Headers.Append(HeaderNames.ContentDisposition, $"attachment; filename=\"{sanitizedFilename}\"");
        Response.ContentType = session.AsZip ? "application/zip" : "application/octet-stream";
        Response.Headers.Append(HeaderNames.AcceptRanges, "bytes");

        if (session.TotalBytes.HasValue && session.TotalBytes > 0)
        {
            var totalBytes = session.TotalBytes.Value;
            var effectiveEnd = endOffset >= 0 ? endOffset : totalBytes - 1;
            var contentLength = effectiveEnd - startOffset + 1;

            Response.Headers.ContentLength = contentLength;

            if (isPartial)
            {
                Response.StatusCode = (int)HttpStatusCode.PartialContent;
                Response.Headers.Append(HeaderNames.ContentRange, $"bytes {startOffset}-{effectiveEnd}/{totalBytes}");
            }
        }
    }

    private static (long Start, long End, bool IsPartial) ParseRangeHeader(string? rangeHeader, long totalBytes)
    {
        if (string.IsNullOrEmpty(rangeHeader) || totalBytes <= 0)
        {
            return (0, -1, false);
        }

        // Parse "bytes=start-end" or "bytes=start-" or "bytes=-end"
        if (!rangeHeader.StartsWith("bytes=", StringComparison.OrdinalIgnoreCase))
        {
            return (0, -1, false);
        }

        var range = rangeHeader["bytes=".Length..];
        var parts = range.Split('-', 2);

        if (parts.Length != 2)
        {
            return (0, -1, false);
        }

        long start = 0;
        long end = totalBytes - 1;

        if (!string.IsNullOrEmpty(parts[0]))
        {
            if (!long.TryParse(parts[0], out start))
            {
                return (0, -1, false);
            }
        }
        else if (!string.IsNullOrEmpty(parts[1]))
        {
            // Suffix range: "-500" means last 500 bytes
            if (!long.TryParse(parts[1], out var suffix))
            {
                return (0, -1, false);
            }
            start = Math.Max(0, totalBytes - suffix);
        }

        if (!string.IsNullOrEmpty(parts[1]) && !string.IsNullOrEmpty(parts[0]))
        {
            if (!long.TryParse(parts[1], out end))
            {
                return (0, -1, false);
            }
        }

        // Validate range
        if (start < 0 || start >= totalBytes || end < start)
        {
            return (0, -1, false);
        }

        return (start, Math.Min(end, totalBytes - 1), true);
    }

    private List<string> NormalizePaths(string[] paths, string rootPath, out string? error)
    {
        error = null;
        var normalizedPaths = new List<string>();
        var root = NormalizeVirtualPath(rootPath);

        foreach (var path in paths)
        {
            if (string.IsNullOrWhiteSpace(path)) continue;

            try
            {
                var normalized = NormalizeVirtualPath(path);
                if (!IsWithinRoot(root, normalized))
                {
                    error = $"Path '{path}' is outside the allowed root.";
                    return [];
                }
                normalizedPaths.Add(normalized);
            }
            catch (ArgumentException ex)
            {
                error = $"Invalid path '{path}': {ex.Message}";
                return [];
            }
        }

        return normalizedPaths;
    }

    private static string GenerateFilename(List<string> paths, bool asZip)
    {
        if (paths.Count == 1 && !asZip)
        {
            var path = paths[0];
            var lastSlash = path.LastIndexOf('/');
            return lastSlash >= 0 ? path[(lastSlash + 1)..] : path;
        }

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
        var invalidChars = Path.GetInvalidFileNameChars();
        var sanitized = new string(filename
            .Select(c => invalidChars.Contains(c) ? '_' : c)
            .ToArray());

        sanitized = sanitized.Replace("\"", "_").Replace("\\", "_");

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
        if (joined.Length > 1 && joined.EndsWith('/'))
        {
            joined = joined.TrimEnd('/');
        }

        return string.IsNullOrEmpty(joined) ? "/" : joined;
    }

    #region Request/Response DTOs

    public sealed record CreateDownloadRequest
    {
        public string SessionId { get; init; } = string.Empty;
        public string[] Paths { get; init; } = [];
        public bool? AsZip { get; init; }
    }

    public sealed record CreateDownloadResponse
    {
        public string DownloadId { get; init; } = string.Empty;
        public string Filename { get; init; } = string.Empty;
        public bool AsZip { get; init; }
        public int PathCount { get; init; }
        public string Status { get; init; } = string.Empty;
        public string StreamUrl { get; init; } = string.Empty;
    }

    public sealed record DownloadStatusResponse
    {
        public string DownloadId { get; init; } = string.Empty;
        public string Status { get; init; } = string.Empty;
        public string Filename { get; init; } = string.Empty;
        public long? TotalBytes { get; init; }
        public long TransferredBytes { get; init; }
        public long SpeedBytesPerSec { get; init; }
        public int? EstimatedSecondsRemaining { get; init; }
        public string? Error { get; init; }
        public string CreatedAt { get; init; } = string.Empty;
        public string? CompletedAt { get; init; }
    }

    #endregion
}
