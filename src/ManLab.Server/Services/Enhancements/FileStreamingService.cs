using System.Collections.Concurrent;
using System.Threading.Channels;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// In-memory streaming service for file downloads.
/// Uses channels to stream file chunks directly from agent to HTTP response without database storage.
/// </summary>
public sealed class FileStreamingService
{
    private readonly ConcurrentDictionary<Guid, StreamingSession> _sessions = new();
    private readonly ILogger<FileStreamingService> _logger;

    public FileStreamingService(ILogger<FileStreamingService> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Represents an active streaming session.
    /// </summary>
    public sealed class StreamingSession : IDisposable
    {
        private readonly Channel<byte[]> _channel;
        private bool _disposed;

        public Guid DownloadId { get; }
        public Guid NodeId { get; }
        public long TotalBytes { get; set; }
        public long BytesReceived { get; private set; }
        public bool IsComplete { get; private set; }
        public string? Error { get; private set; }
        public DateTime CreatedAt { get; } = DateTime.UtcNow;
        public CancellationTokenSource CancellationSource { get; } = new();

        /// <summary>
        /// Reader for consuming chunks from the channel.
        /// </summary>
        public ChannelReader<byte[]> Reader => _channel.Reader;

        public StreamingSession(Guid downloadId, Guid nodeId, int capacity = 32)
        {
            DownloadId = downloadId;
            NodeId = nodeId;
            // Bounded channel to apply backpressure if consumer is slow
            _channel = Channel.CreateBounded<byte[]>(new BoundedChannelOptions(capacity)
            {
                FullMode = BoundedChannelFullMode.Wait,
                SingleReader = true,
                SingleWriter = true
            });
        }

        /// <summary>
        /// Writes a chunk to the channel. Called by the agent via SignalR.
        /// </summary>
        public async ValueTask<bool> WriteChunkAsync(byte[] chunk, CancellationToken cancellationToken = default)
        {
            if (_disposed || IsComplete)
            {
                return false;
            }

            try
            {
                await _channel.Writer.WriteAsync(chunk, cancellationToken);
                BytesReceived += chunk.Length;
                return true;
            }
            catch (ChannelClosedException)
            {
                return false;
            }
        }

        /// <summary>
        /// Marks the stream as complete (success).
        /// </summary>
        public void Complete()
        {
            if (_disposed) return;
            IsComplete = true;
            _channel.Writer.TryComplete();
        }

        /// <summary>
        /// Marks the stream as failed with an error.
        /// </summary>
        public void Fail(string error)
        {
            if (_disposed) return;
            IsComplete = true;
            Error = error;
            _channel.Writer.TryComplete(new InvalidOperationException(error));
        }

        public void Dispose()
        {
            if (_disposed) return;
            _disposed = true;

            try
            {
                CancellationSource.Cancel();
                CancellationSource.Dispose();
            }
            catch { }

            _channel.Writer.TryComplete();
        }
    }

    /// <summary>
    /// Creates a new streaming session for a download.
    /// </summary>
    public StreamingSession CreateSession(Guid downloadId, Guid nodeId, long totalBytes = 0)
    {
        var session = new StreamingSession(downloadId, nodeId)
        {
            TotalBytes = totalBytes
        };

        if (!_sessions.TryAdd(downloadId, session))
        {
            session.Dispose();
            throw new InvalidOperationException($"Streaming session {downloadId} already exists.");
        }

        _logger.LogInformation(
            "Created streaming session {DownloadId} for node {NodeId}, totalBytes: {TotalBytes}",
            downloadId, nodeId, totalBytes);

        return session;
    }

    /// <summary>
    /// Gets an existing streaming session.
    /// </summary>
    public bool TryGetSession(Guid downloadId, out StreamingSession? session)
    {
        return _sessions.TryGetValue(downloadId, out session);
    }

    /// <summary>
    /// Writes a chunk to an existing session. Called by the agent via SignalR.
    /// </summary>
    public async ValueTask<bool> WriteChunkAsync(Guid downloadId, byte[] chunk, CancellationToken cancellationToken = default)
    {
        if (!_sessions.TryGetValue(downloadId, out var session))
        {
            _logger.LogWarning("Attempted to write chunk to unknown session {DownloadId}", downloadId);
            return false;
        }

        return await session.WriteChunkAsync(chunk, cancellationToken);
    }

    /// <summary>
    /// Updates the total bytes for a session (called when agent reports file size).
    /// </summary>
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
    /// Completes a streaming session successfully.
    /// </summary>
    public bool CompleteSession(Guid downloadId)
    {
        if (!_sessions.TryGetValue(downloadId, out var session))
        {
            return false;
        }

        session.Complete();
        _logger.LogInformation(
            "Streaming session {DownloadId} completed, {BytesReceived} bytes received",
            downloadId, session.BytesReceived);

        return true;
    }

    /// <summary>
    /// Fails a streaming session with an error.
    /// </summary>
    public bool FailSession(Guid downloadId, string error)
    {
        if (!_sessions.TryGetValue(downloadId, out var session))
        {
            return false;
        }

        session.Fail(error);
        _logger.LogWarning("Streaming session {DownloadId} failed: {Error}", downloadId, error);

        return true;
    }

    /// <summary>
    /// Removes and disposes a streaming session.
    /// </summary>
    public bool RemoveSession(Guid downloadId)
    {
        if (_sessions.TryRemove(downloadId, out var session))
        {
            session.Dispose();
            _logger.LogInformation("Streaming session {DownloadId} removed", downloadId);
            return true;
        }

        return false;
    }

    /// <summary>
    /// Cleans up expired sessions.
    /// </summary>
    public int CleanupExpiredSessions(TimeSpan maxAge)
    {
        var cutoff = DateTime.UtcNow - maxAge;
        var expiredIds = _sessions
            .Where(kvp => kvp.Value.CreatedAt < cutoff)
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
            _logger.LogInformation("Cleaned up {Count} expired streaming sessions", count);
        }

        return count;
    }
}
