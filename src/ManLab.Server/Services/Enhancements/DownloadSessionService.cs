using System.Collections.Concurrent;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// In-memory session management for file downloads with progress tracking.
/// Sessions are short-lived and support cancellation.
/// </summary>
public sealed class DownloadSessionService
{
    private static readonly TimeSpan DefaultTtl = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan MaxTtl = TimeSpan.FromHours(2);

    private readonly ConcurrentDictionary<Guid, DownloadSession> _sessions = new();
    private readonly ILogger<DownloadSessionService> _logger;

    public DownloadSessionService(ILogger<DownloadSessionService> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Represents the status of a download session.
    /// </summary>
    public enum DownloadStatus
    {
        Queued,
        Preparing,
        Ready,
        Downloading,
        Completed,
        Failed,
        Cancelled
    }

    /// <summary>
    /// Represents an active download session.
    /// </summary>
    public sealed class DownloadSession
    {
        public Guid Id { get; init; }
        public Guid NodeId { get; init; }
        public string FileBrowserSessionId { get; init; } = string.Empty;
        public string[] Paths { get; init; } = [];
        public bool AsZip { get; init; }
        public string Filename { get; init; } = string.Empty;
        public DownloadStatus Status { get; set; } = DownloadStatus.Queued;
        public long? TotalBytes { get; set; }
        public long TransferredBytes { get; set; }
        public DateTime CreatedAt { get; init; }
        public DateTime ExpiresAt { get; init; }
        public DateTime? CompletedAt { get; set; }
        public string? Error { get; set; }
        public string? RequestedBy { get; init; }
        public CancellationTokenSource CancellationSource { get; init; } = new();

        /// <summary>
        /// The SignalR connection ID of the client that initiated the download.
        /// Used to forward progress updates to the correct client.
        /// </summary>
        public string? ClientConnectionId { get; init; }

        /// <summary>
        /// The path to the temporary zip file on the agent (for zip downloads).
        /// Set after the agent completes zip creation.
        /// </summary>
        public string? TempFilePath { get; set; }

        /// <summary>
        /// Track the last time a zip progress update was forwarded for this session.
        /// Used for throttling updates.
        /// </summary>
        public DateTime? LastZipProgressUpdateAt { get; set; }
    }

    /// <summary>
    /// Creates a new download session.
    /// </summary>
    /// <param name="nodeId">The target node ID.</param>
    /// <param name="fileBrowserSessionId">The file browser session ID for authorization.</param>
    /// <param name="paths">The paths to download.</param>
    /// <param name="asZip">Whether to create a zip archive.</param>
    /// <param name="filename">The output filename.</param>
    /// <param name="requestedBy">User/requester identity for auditing.</param>
    /// <param name="clientConnectionId">The SignalR connection ID of the requesting client.</param>
    /// <param name="ttl">Optional TTL override (clamped to max).</param>
    /// <returns>The created download session.</returns>
    public DownloadSession CreateSession(
        Guid nodeId,
        string fileBrowserSessionId,
        string[] paths,
        bool asZip,
        string filename,
        string? requestedBy = null,
        string? clientConnectionId = null,
        TimeSpan? ttl = null)
    {
        var effectiveTtl = ttl ?? DefaultTtl;
        if (effectiveTtl <= TimeSpan.Zero)
        {
            effectiveTtl = DefaultTtl;
        }

        if (effectiveTtl > MaxTtl)
        {
            effectiveTtl = MaxTtl;
        }

        var now = DateTime.UtcNow;
        var sessionId = Guid.NewGuid();

        var session = new DownloadSession
        {
            Id = sessionId,
            NodeId = nodeId,
            FileBrowserSessionId = fileBrowserSessionId,
            Paths = paths,
            AsZip = asZip,
            Filename = filename,
            Status = DownloadStatus.Queued,
            CreatedAt = now,
            ExpiresAt = now.Add(effectiveTtl),
            RequestedBy = requestedBy,
            ClientConnectionId = clientConnectionId,
            CancellationSource = new CancellationTokenSource()
        };

        _sessions[sessionId] = session;

        _logger.LogInformation(
            "Download session created {SessionId} for node {NodeId}, paths: {PathCount}, asZip: {AsZip}",
            sessionId, nodeId, paths.Length, asZip);

        return session;
    }

    /// <summary>
    /// Attempts to get an active session.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <param name="session">The session if found and not expired.</param>
    /// <returns>True if the session was found and is valid.</returns>
    public bool TryGetSession(Guid downloadId, out DownloadSession? session)
    {
        if (_sessions.TryGetValue(downloadId, out session))
        {
            // Check if session has expired
            if (DateTime.UtcNow > session.ExpiresAt)
            {
                _logger.LogInformation("Download session {SessionId} has expired", downloadId);
                _sessions.TryRemove(downloadId, out _);
                session = null;
                return false;
            }

            return true;
        }

        session = null;
        return false;
    }

    /// <summary>
    /// Updates the progress of a download session.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <param name="bytesTransferred">The number of bytes transferred so far.</param>
    /// <param name="totalBytes">The total number of bytes to transfer.</param>
    /// <returns>True if the session was found and updated.</returns>
    public bool UpdateProgress(Guid downloadId, long bytesTransferred, long totalBytes)
    {
        if (!_sessions.TryGetValue(downloadId, out var session))
        {
            return false;
        }

        session.TransferredBytes = bytesTransferred;
        if (totalBytes > 0)
        {
            session.TotalBytes = totalBytes;
        }

        // Update status to downloading if still in preparing state
        if (session.Status == DownloadStatus.Preparing || session.Status == DownloadStatus.Queued)
        {
            session.Status = DownloadStatus.Downloading;
        }

        return true;
    }

    /// <summary>
    /// Updates the status of a download session.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <param name="status">The new status.</param>
    /// <returns>True if the session was found and updated.</returns>
    public bool UpdateStatus(Guid downloadId, DownloadStatus status)
    {
        if (!_sessions.TryGetValue(downloadId, out var session))
        {
            return false;
        }

        session.Status = status;
        return true;
    }

    /// <summary>
    /// Sets the total bytes for a download session.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <param name="totalBytes">The total number of bytes.</param>
    /// <returns>True if the session was found and updated.</returns>
    public bool SetTotalBytes(Guid downloadId, long totalBytes)
    {
        if (!_sessions.TryGetValue(downloadId, out var session))
        {
            return false;
        }

        session.TotalBytes = totalBytes;
        return true;
    }

    /// <summary>
    /// Sets the temp file path for a zip download session.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <param name="tempFilePath">The path to the temp zip file on the agent.</param>
    /// <returns>True if the session was found and updated.</returns>
    public bool SetTempFilePath(Guid downloadId, string tempFilePath)
    {
        if (!_sessions.TryGetValue(downloadId, out var session))
        {
            return false;
        }

        session.TempFilePath = tempFilePath;
        return true;
    }

    /// <summary>
    /// Marks a download session as complete.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <param name="success">Whether the download completed successfully.</param>
    /// <param name="error">Error message if the download failed.</param>
    /// <returns>True if the session was found and updated.</returns>
    public bool CompleteSession(Guid downloadId, bool success, string? error = null)
    {
        if (!_sessions.TryGetValue(downloadId, out var session))
        {
            return false;
        }

        session.Status = success ? DownloadStatus.Completed : DownloadStatus.Failed;
        session.CompletedAt = DateTime.UtcNow;
        session.Error = error;

        _logger.LogInformation(
            "Download session {SessionId} completed: success={Success}, error={Error}",
            downloadId, success, error ?? "none");

        return true;
    }

    /// <summary>
    /// Cancels a download session.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <returns>True if the session was found and cancelled.</returns>
    public bool CancelSession(Guid downloadId)
    {
        if (!_sessions.TryGetValue(downloadId, out var session))
        {
            return false;
        }

        // Signal cancellation to any ongoing operations
        try
        {
            session.CancellationSource.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // Already disposed, ignore
        }

        session.Status = DownloadStatus.Cancelled;
        session.CompletedAt = DateTime.UtcNow;

        _logger.LogInformation("Download session {SessionId} cancelled", downloadId);

        return true;
    }

    /// <summary>
    /// Removes a download session from memory.
    /// </summary>
    /// <param name="downloadId">The download session ID.</param>
    /// <returns>True if the session was found and removed.</returns>
    public bool RemoveSession(Guid downloadId)
    {
        if (_sessions.TryRemove(downloadId, out var session))
        {
            // Dispose the cancellation token source
            try
            {
                session.CancellationSource.Dispose();
            }
            catch (ObjectDisposedException)
            {
                // Already disposed, ignore
            }

            _logger.LogInformation("Download session {SessionId} removed", downloadId);
            return true;
        }

        return false;
    }

    /// <summary>
    /// Gets all active download sessions for a node.
    /// </summary>
    /// <param name="nodeId">The node ID.</param>
    /// <returns>List of active download sessions.</returns>
    public IReadOnlyList<DownloadSession> GetSessionsForNode(Guid nodeId)
    {
        var now = DateTime.UtcNow;
        return _sessions.Values
            .Where(s => s.NodeId == nodeId && s.ExpiresAt > now)
            .ToList();
    }

    /// <summary>
    /// Cleans up expired sessions.
    /// </summary>
    /// <returns>The number of sessions cleaned up.</returns>
    public int CleanupExpiredSessions()
    {
        var now = DateTime.UtcNow;
        var expiredIds = _sessions
            .Where(kvp => kvp.Value.ExpiresAt <= now)
            .Select(kvp => kvp.Key)
            .ToList();

        var count = 0;
        foreach (var id in expiredIds)
        {
            if (RemoveSession(id))
            {
                count++;
            }
        }

        if (count > 0)
        {
            _logger.LogInformation("Cleaned up {Count} expired download sessions", count);
        }

        return count;
    }
}
