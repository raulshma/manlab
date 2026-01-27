using System.IO.Compression;
using System.Net;
using ManLab.Server.Data;
using ManLab.Server.Services.Ssh;
using ManLab.Server.Services.Enhancements;
using ManLab.Shared.Dtos;
using ManLab.Server.Services.Security;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Microsoft.Net.Http.Headers;

namespace ManLab.Server.Controllers.Enhancements;

/// <summary>
/// SSH/SFTP-based file download controller.
/// Downloads files directly from remote machines using stored SSH credentials from onboarding.
/// This bypasses the agent's SignalR-based file streaming and uses direct SFTP connections.
/// </summary>
[ApiController]
[Authorize(Policy = Permissions.PolicyPrefix + Permissions.FileBrowserView)]
public sealed class SshFileDownloadController : ControllerBase
{
    private const int DefaultMaxEntries = 5_000;
    private const int MaxEntriesUpperBound = 50_000;
    private const int DefaultChunkSize = 1024 * 1024; // 1MB
    private static readonly TimeSpan StreamingTimeout = TimeSpan.FromMinutes(30);

    private readonly DataContext _db;
    private readonly SshFileService _sshFileService;
    private readonly FileBrowserSessionService _fileBrowserSessions;
    private readonly RemoteToolsAuthorizationService _authorization;
    private readonly ILogger<SshFileDownloadController> _logger;

    public SshFileDownloadController(
        DataContext db,
        SshFileService sshFileService,
        FileBrowserSessionService fileBrowserSessions,
        RemoteToolsAuthorizationService authorization,
        ILogger<SshFileDownloadController> logger)
    {
        _db = db;
        _sshFileService = sshFileService;
        _fileBrowserSessions = fileBrowserSessions;
        _authorization = authorization;
        _logger = logger;
    }

    /// <summary>
    /// Checks if SSH download is available for a node (has linked onboarding machine with saved credentials).
    /// </summary>
    [HttpGet("/api/devices/{nodeId:guid}/ssh-download/status")]
    public async Task<ActionResult<SshDownloadStatusResponse>> GetSshDownloadStatus(
        Guid nodeId,
        CancellationToken ct)
    {
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId, ct);
        if (!nodeExists)
        {
            return NotFound("Node not found.");
        }

        var creds = await _sshFileService.GetCredentialsForNodeAsync(nodeId, ct);

        return Ok(new SshDownloadStatusResponse
        {
            Available = creds.Success,
            NodeId = nodeId,
            MachineId = creds.Machine?.Id,
            Host = creds.Machine?.Host,
            Username = creds.Machine?.Username,
            HasCredentials = creds.Success && creds.Auth != null,
            AuthMode = creds.Machine?.AuthMode.ToString(),
            Message = creds.Success ? "SSH download available" : creds.Error,
            Error = creds.Error
        });
    }

    /// <summary>
    /// Lists files via SSH/SFTP using onboarding credentials.
    /// </summary>
    [HttpPost("/api/devices/{nodeId:guid}/ssh-file-browser/list")]
    public async Task<ActionResult<SshFileListResponse>> ListFiles(
        Guid nodeId,
        [FromBody] SshFileListRequest? request,
        CancellationToken ct)
    {
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId, ct);
        if (!nodeExists)
        {
            return NotFound("Node not found.");
        }

        var path = NormalizeVirtualPath(request?.Path);
        var maxEntries = Math.Clamp(request?.MaxEntries ?? DefaultMaxEntries, 1, MaxEntriesUpperBound);

        var result = await _sshFileService.ListFilesAsync(nodeId, path, maxEntries, ct);

        if (!result.Success)
        {
            return BadRequest(new SshFileListResponse
            {
                NodeId = nodeId,
                Path = path,
                Entries = [],
                Truncated = false,
                Error = result.Error
            });
        }

        var entries = result.Entries.Select(e => new FileBrowserEntry
        {
            Name = e.Name,
            Path = e.Path,
            IsDirectory = e.IsDirectory,
            Size = e.Size,
            UpdatedAt = e.LastModified?.ToString("O")
        }).ToArray();

        return Ok(new SshFileListResponse
        {
            NodeId = nodeId,
            Path = path,
            Entries = entries,
            Truncated = result.Truncated,
            Error = null
        });
    }

    /// <summary>
    /// Downloads a single file via SSH/SFTP.
    /// Streams directly to the client for maximum performance.
    /// </summary>
    [HttpGet("/api/devices/{nodeId:guid}/ssh-download/file")]
    public async Task DownloadFile(
        Guid nodeId,
        [FromQuery] string path,
        CancellationToken ct)
    {
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId, ct);
        if (!nodeExists)
        {
            Response.StatusCode = (int)HttpStatusCode.NotFound;
            await Response.WriteAsync("Node not found.", ct);
            return;
        }

        if (string.IsNullOrWhiteSpace(path))
        {
            Response.StatusCode = (int)HttpStatusCode.BadRequest;
            await Response.WriteAsync("Path is required.", ct);
            return;
        }

        var normalizedPath = NormalizeVirtualPath(path);

        // Get file metadata first
        var metadata = await _sshFileService.GetFileMetadataAsync(nodeId, normalizedPath, ct);
        if (metadata is null)
        {
            Response.StatusCode = (int)HttpStatusCode.NotFound;
            await Response.WriteAsync("File not found or SSH credentials unavailable.", ct);
            return;
        }

        var (size, lastModified) = metadata.Value;
        var filename = SanitizeFilename(Path.GetFileName(normalizedPath) ?? "file");

        // Set response headers
        Response.Headers.Append(HeaderNames.ContentDisposition, $"attachment; filename=\"{filename}\"");
        Response.ContentType = "application/octet-stream";
        Response.Headers.ContentLength = size;
        Response.Headers.Append(HeaderNames.LastModified, lastModified.ToString("R"));
        Response.Headers.Append(HeaderNames.AcceptRanges, "none"); // No range support for now

        _logger.LogInformation(
            "Starting SSH download for node {NodeId}, file: {Path}, size: {Size}",
            nodeId, normalizedPath, size);

        try
        {
            await _sshFileService.DownloadFileAsync(
                nodeId,
                normalizedPath,
                Response.Body,
                null, // No progress callback for now
                ct);

            _logger.LogInformation(
                "SSH download completed for node {NodeId}, file: {Path}",
                nodeId, normalizedPath);
        }
        catch (FileNotFoundException)
        {
            if (!Response.HasStarted)
            {
                Response.StatusCode = (int)HttpStatusCode.NotFound;
            }
            else
            {
                HttpContext.Abort();
            }
        }
        catch (UnauthorizedAccessException)
        {
            if (!Response.HasStarted)
            {
                Response.StatusCode = (int)HttpStatusCode.Forbidden;
            }
            else
            {
                HttpContext.Abort();
            }
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("SSH download cancelled for node {NodeId}, file: {Path}", nodeId, normalizedPath);
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
            _logger.LogError(ex, "SSH download failed for node {NodeId}, file: {Path}", nodeId, normalizedPath);
            if (!Response.HasStarted)
            {
                Response.StatusCode = (int)HttpStatusCode.InternalServerError;
                await Response.WriteAsync($"Download failed: {ex.Message}", ct);
            }
            else
            {
                HttpContext.Abort();
            }
        }
    }

    /// <summary>
    /// Downloads multiple files/folders as a zip archive via SSH/SFTP.
    /// </summary>
    [HttpPost("/api/devices/{nodeId:guid}/ssh-download/zip")]
    public async Task DownloadAsZip(
        Guid nodeId,
        [FromBody] SshZipDownloadRequest request,
        CancellationToken ct)
    {
        var nodeExists = await _db.Nodes.AsNoTracking().AnyAsync(n => n.Id == nodeId, ct);
        if (!nodeExists)
        {
            Response.StatusCode = (int)HttpStatusCode.NotFound;
            await Response.WriteAsync("Node not found.", ct);
            return;
        }

        if (request?.Paths is null || request.Paths.Length == 0)
        {
            Response.StatusCode = (int)HttpStatusCode.BadRequest;
            await Response.WriteAsync("At least one path is required.", ct);
            return;
        }

        var normalizedPaths = request.Paths
            .Where(p => !string.IsNullOrWhiteSpace(p))
            .Select(NormalizeVirtualPath)
            .ToArray();

        if (normalizedPaths.Length == 0)
        {
            Response.StatusCode = (int)HttpStatusCode.BadRequest;
            await Response.WriteAsync("No valid paths provided.", ct);
            return;
        }

        // Generate filename
        var filename = GenerateZipFilename(normalizedPaths);

        // Set response headers
        Response.Headers.Append(HeaderNames.ContentDisposition, $"attachment; filename=\"{filename}\"");
        Response.ContentType = "application/zip";
        // Note: We can't set Content-Length for zip streams since we don't know the final size

        _logger.LogInformation(
            "Starting SSH zip download for node {NodeId}, paths: {PathCount}",
            nodeId, normalizedPaths.Length);

        try
        {
            await _sshFileService.DownloadAsZipAsync(
                nodeId,
                normalizedPaths,
                Response.Body,
                null, // No progress callback for now
                ct);

            _logger.LogInformation(
                "SSH zip download completed for node {NodeId}",
                nodeId);
        }
        catch (OperationCanceledException)
        {
            _logger.LogInformation("SSH zip download cancelled for node {NodeId}", nodeId);
            if (!Response.HasStarted)
            {
                Response.StatusCode = 499;
            }
            else
            {
                HttpContext.Abort();
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "SSH zip download failed for node {NodeId}", nodeId);
            if (!Response.HasStarted)
            {
                Response.StatusCode = (int)HttpStatusCode.InternalServerError;
                await Response.WriteAsync($"Download failed: {ex.Message}", ct);
            }
            else
            {
                HttpContext.Abort();
            }
        }
    }

    private static string NormalizeVirtualPath(string? input)
    {
        var p = (input ?? string.Empty).Trim();
        if (string.IsNullOrEmpty(p)) return "/";

        p = p.Replace('\\', '/');

        if (!p.StartsWith('/'))
        {
            p = "/" + p;
        }

        // Don't throw on ':' - Windows paths are expected
        // The SshFileService handles the conversion

        var segments = p.Split('/', StringSplitOptions.RemoveEmptyEntries);
        var normalized = new List<string>(segments.Length);
        foreach (var seg in segments)
        {
            if (seg == ".") continue;
            if (seg == "..") continue; // Skip path traversal for safety
            normalized.Add(seg);
        }

        var joined = "/" + string.Join("/", normalized);
        if (joined.Length > 1 && joined.EndsWith('/'))
        {
            joined = joined.TrimEnd('/');
        }

        return string.IsNullOrEmpty(joined) ? "/" : joined;
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

        return string.IsNullOrEmpty(sanitized) ? "file" : sanitized;
    }

    private static string GenerateZipFilename(string[] paths)
    {
        if (paths.Length == 1)
        {
            var path = paths[0];
            var lastSlash = path.LastIndexOf('/');
            var name = lastSlash >= 0 ? path[(lastSlash + 1)..] : path;
            if (!string.IsNullOrWhiteSpace(name))
            {
                return SanitizeFilename(name) + ".zip";
            }
        }

        return $"download_{DateTime.UtcNow:yyyyMMdd_HHmmss}.zip";
    }

    #region Request/Response DTOs

    public sealed record SshDownloadStatusResponse
    {
        public bool Available { get; init; }
        public Guid? NodeId { get; init; }
        public Guid? MachineId { get; init; }
        public string? Host { get; init; }
        public string? Username { get; init; }
        public bool HasCredentials { get; init; }
        public string? AuthMode { get; init; }
        public string? Message { get; init; }
        public string? Error { get; init; }
    }

    public sealed record SshFileListRequest
    {
        public string? Path { get; init; }
        public int? MaxEntries { get; init; }
    }

    public sealed record SshFileListResponse
    {
        public Guid NodeId { get; init; }
        public string Path { get; init; } = "/";
        public FileBrowserEntry[] Entries { get; init; } = [];
        public bool Truncated { get; init; }
        public string? Error { get; init; }
    }

    public sealed record SshZipDownloadRequest
    {
        public string[] Paths { get; init; } = [];
    }

    #endregion
}
