using System.Collections.Concurrent;
using System.Threading.Channels;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// High-performance streaming download service for large files.
/// Uses unbounded channels with backpressure to stream data from agent to HTTP response.
/// Optimized for multi-gigabyte file transfers.
/// </summary>
public sealed class StreamingDownloadService
{
    private readonly ConcurrentDictionary<Guid, StreamingDownload> _downloads = new();
    private readonly ILogger<StreamingDownloadService> _logger;

    // Configuration for streaming performance
    public const int DefaultChunkSize = 1024 * 1024; // 1MB chunks for throughput
    public const int ChannelCapacity = 16; // Buffer 16 chunks (16MB) for backpressure
    private static readonly TimeSpan SessionTimeout = TimeSpan.FromHours(4);

    public StreamingDownloadService(ILogger<StreamingDownloadService> logger)
    {
        _logger = logger;
    }

    /// <summary>
    /// Represents an active streaming download with progress tracking.
    /// </summary>
    public sealed class StreamingDownload : IDisposable
    {
        private readonly Channel<ReadOnlyMemory<byte>> _channel;
        private bool _disposed;
        private long _bytesReceived;

        public Guid Id { get; }
        public Guid NodeId { get; }
        public string FilePath { get; }
        public long TotalBytes { get; private set; }
        public long BytesReceived => Interlocked.Read(ref _bytesReceived);
        public bool IsComplete { get; private set; }
        public bool IsFailed { get; private set; }
        public string? Error { get; private set; }
        public DateTime CreatedAt { get; } = DateTime.UtcNow;
        public DateTime LastActivity { get; private set; } = DateTime.UtcNow;
        public CancellationTokenSource CancellationSource { get; } = new();

        // For resumable downloads
        public long StartOffset { get; init; }
        public long EndOffset { get; init; } // -1 means end of file

        /// <summary>
        /// Reader for consuming chunks from the channel.
        /// </summary>
        public ChannelReader<ReadOnlyMemory<byte>> Reader => _channel.Reader;

        /// <summary>
        /// Writer for the agent to push chunks.
        /// </summary>
        public ChannelWriter<ReadOnlyMemory<byte>> Writer => _channel.Writer;

        public StreamingDownload(
            Guid id,
            Guid nodeId,
            string filePath,
            long totalBytes = 0,
            long startOffset = 0,
            long endOffset = -1)
        {
            Id = id;
            NodeId = nodeId;
            FilePath = filePath;
            TotalBytes = totalBytes;
            StartOffset = startOffset;
            EndOffset = endOffset;

            // Bounded channel with wait mode for backpressure
            // This prevents memory exhaustion if the client reads slowly
            _channel = Channel.CreateBounded<ReadOnlyMemory<byte>>(
                new BoundedChannelOptions(ChannelCapacity)
                {
                    FullMode = BoundedChannelFullMode.Wait,
                    SingleReader = true,
                    SingleWriter = true,
                    AllowSynchronousContinuations = false
                });
        }

        /// <summary>
        /// Writes a chunk to the channel. Called by the agent via SignalR.
        /// Returns false if the channel is completed or disposed.
        /// </summary>
        public async ValueTask<bool> WriteChunkAsync(
            ReadOnlyMemory<byte> chunk,
            CancellationToken cancellationToken = default)
        {
            if (_disposed || IsComplete || IsFailed)
            {
                return false;
            }

            try
            {
                await _channel.Writer.WriteAsync(chunk, cancellationToken);
                Interlocked.Add(ref _bytesReceived, chunk.Length);
                LastActivity = DateTime.UtcNow;
                return true;
            }
            catch (ChannelClosedException)
            {
                return false;
            }
            catch (OperationCanceledException)
            {
                return false;
            }
        }

        /// <summary>
        /// Sets the total bytes for this download (called when agent knows file size).
        /// </summary>
        public void SetTotalBytes(long totalBytes)
        {
            TotalBytes = totalBytes;
            LastActivity = DateTime.UtcNow;
        }

        /// <summary>
        /// Marks the stream as complete (all data sent).
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
            IsFailed = true;
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
            catch { /* ignore disposal errors */ }

            _channel.Writer.TryComplete();
        }
    }

    /// <summary>
    /// Creates a new streaming download session.
    /// </summary>
    /// <param name="nodeId">The node that will stream the file.</param>
    /// <param name="filePath">The virtual or actual file path.</param>
    /// <param name="totalBytes">Total file size if known.</param>
    /// <param name="startOffset">Byte offset to start streaming from (for resumable downloads).</param>
    /// <param name="endOffset">Byte offset to end streaming at (-1 for end of file).</param>
    /// <returns>The created streaming download session.</returns>
    public StreamingDownload CreateDownload(
        Guid nodeId,
        string filePath,
        long totalBytes = 0,
        long startOffset = 0,
        long endOffset = -1)
    {
        var id = Guid.NewGuid();
        var download = new StreamingDownload(id, nodeId, filePath, totalBytes, startOffset, endOffset);

        if (!_downloads.TryAdd(id, download))
        {
            download.Dispose();
            throw new InvalidOperationException($"Failed to create streaming download {id}.");
        }

        _logger.LogInformation(
            "Created streaming download {DownloadId} for node {NodeId}, file: {FilePath}, " +
            "totalBytes: {TotalBytes}, range: {StartOffset}-{EndOffset}",
            id, nodeId, filePath, totalBytes, startOffset, endOffset >= 0 ? endOffset : "EOF");

        return download;
    }

    /// <summary>
    /// Gets an existing streaming download by ID.
    /// </summary>
    public bool TryGetDownload(Guid downloadId, out StreamingDownload? download)
    {
        return _downloads.TryGetValue(downloadId, out download);
    }

    /// <summary>
    /// Writes a chunk to an existing download. Called by the agent via SignalR.
    /// </summary>
    public async ValueTask<bool> WriteChunkAsync(
        Guid downloadId,
        ReadOnlyMemory<byte> chunk,
        CancellationToken cancellationToken = default)
    {
        if (!_downloads.TryGetValue(downloadId, out var download))
        {
            _logger.LogWarning("Attempted to write chunk to unknown download {DownloadId}", downloadId);
            return false;
        }

        return await download.WriteChunkAsync(chunk, cancellationToken);
    }

    /// <summary>
    /// Updates the total bytes for a download.
    /// </summary>
    public bool SetTotalBytes(Guid downloadId, long totalBytes)
    {
        if (!_downloads.TryGetValue(downloadId, out var download))
        {
            return false;
        }

        download.SetTotalBytes(totalBytes);
        return true;
    }

    /// <summary>
    /// Completes a streaming download successfully.
    /// </summary>
    public bool CompleteDownload(Guid downloadId)
    {
        if (!_downloads.TryGetValue(downloadId, out var download))
        {
            return false;
        }

        download.Complete();
        _logger.LogInformation(
            "Streaming download {DownloadId} completed, {BytesReceived} bytes received",
            downloadId, download.BytesReceived);

        return true;
    }

    /// <summary>
    /// Fails a streaming download with an error.
    /// </summary>
    public bool FailDownload(Guid downloadId, string error)
    {
        if (!_downloads.TryGetValue(downloadId, out var download))
        {
            return false;
        }

        download.Fail(error);
        _logger.LogWarning("Streaming download {DownloadId} failed: {Error}", downloadId, error);

        return true;
    }

    /// <summary>
    /// Removes and disposes a streaming download.
    /// </summary>
    public bool RemoveDownload(Guid downloadId)
    {
        if (_downloads.TryRemove(downloadId, out var download))
        {
            download.Dispose();
            _logger.LogInformation("Streaming download {DownloadId} removed", downloadId);
            return true;
        }

        return false;
    }

    /// <summary>
    /// Cleans up expired or timed-out download sessions.
    /// </summary>
    public int CleanupExpiredSessions()
    {
        var cutoff = DateTime.UtcNow - SessionTimeout;
        var expiredIds = _downloads
            .Where(kvp => kvp.Value.CreatedAt < cutoff ||
                          (kvp.Value.IsComplete || kvp.Value.IsFailed))
            .Select(kvp => kvp.Key)
            .ToList();

        var count = 0;
        foreach (var id in expiredIds)
        {
            if (RemoveDownload(id))
            {
                count++;
            }
        }

        if (count > 0)
        {
            _logger.LogInformation("Cleaned up {Count} expired streaming downloads", count);
        }

        return count;
    }

    /// <summary>
    /// Gets statistics about active downloads.
    /// </summary>
    public (int Active, int Complete, int Failed, long TotalBytesTransferred) GetStatistics()
    {
        var active = 0;
        var complete = 0;
        var failed = 0;
        long totalBytes = 0;

        foreach (var download in _downloads.Values)
        {
            if (download.IsComplete)
            {
                complete++;
            }
            else if (download.IsFailed)
            {
                failed++;
            }
            else
            {
                active++;
            }
            totalBytes += download.BytesReceived;
        }

        return (active, complete, failed, totalBytes);
    }
}
