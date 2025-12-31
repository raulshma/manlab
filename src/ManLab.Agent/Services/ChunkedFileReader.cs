using System.Buffers;
using System.IO.Pipelines;
using System.Runtime.CompilerServices;

namespace ManLab.Agent.Services;

/// <summary>
/// High-performance chunked file reader using Pipelines for efficient large file streaming.
/// Optimized for multi-gigabyte files with minimal allocations and memory pressure.
/// </summary>
public sealed class ChunkedFileReader : IDisposable
{
    /// <summary>
    /// Default chunk size (1MB) optimized for network throughput on large files.
    /// </summary>
    public const int DefaultChunkSize = 1024 * 1024;

    /// <summary>
    /// Minimum chunk size (64KB) for smaller files or memory-constrained scenarios.
    /// </summary>
    public const int MinChunkSize = 64 * 1024;

    /// <summary>
    /// Maximum chunk size (4MB) to balance memory usage and throughput.
    /// </summary>
    public const int MaxChunkSize = 4 * 1024 * 1024;

    private readonly ArrayPool<byte> _arrayPool;
    private bool _disposed;

    public ChunkedFileReader()
    {
        // Use shared pool for reduced allocations
        _arrayPool = ArrayPool<byte>.Shared;
    }

    /// <summary>
    /// Streams file content as an async enumerable of byte chunks.
    /// Uses Pipelines for efficient reading with minimal allocations.
    /// </summary>
    /// <param name="filePath">The absolute path to the file to stream.</param>
    /// <param name="chunkSize">Size of each chunk in bytes.</param>
    /// <param name="startOffset">Byte offset to start reading from (for resumable downloads).</param>
    /// <param name="endOffset">Byte offset to stop reading at (-1 for end of file).</param>
    /// <param name="progressCallback">Optional callback for progress reporting (bytesRead, totalBytes).</param>
    /// <param name="cancellationToken">Token to cancel the streaming operation.</param>
    /// <returns>An async enumerable of byte array chunks.</returns>
    public async IAsyncEnumerable<byte[]> ReadFileChunksAsync(
        string filePath,
        int chunkSize = DefaultChunkSize,
        long startOffset = 0,
        long endOffset = -1,
        Func<long, long, ValueTask>? progressCallback = null,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("File path cannot be null or empty.", nameof(filePath));
        }

        if (!File.Exists(filePath))
        {
            throw new FileNotFoundException($"File not found: {filePath}", filePath);
        }

        // Clamp chunk size to valid range
        chunkSize = Math.Clamp(chunkSize, MinChunkSize, MaxChunkSize);

        var fileInfo = new FileInfo(filePath);
        var totalBytes = fileInfo.Length;

        // Validate offsets
        if (startOffset < 0 || startOffset >= totalBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(startOffset),
                $"Start offset {startOffset} is out of range for file of size {totalBytes}.");
        }

        var effectiveEnd = endOffset < 0 ? totalBytes : Math.Min(endOffset + 1, totalBytes);
        if (effectiveEnd <= startOffset)
        {
            throw new ArgumentOutOfRangeException(nameof(endOffset),
                $"End offset {endOffset} must be greater than start offset {startOffset}.");
        }

        var bytesToRead = effectiveEnd - startOffset;

        // Open file with optimal settings for sequential reading
        await using var fileStream = new FileStream(
            filePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: chunkSize,
            options: FileOptions.Asynchronous | FileOptions.SequentialScan);

        if (startOffset > 0)
        {
            fileStream.Seek(startOffset, SeekOrigin.Begin);
        }

        long bytesRead = 0;

        // Rent buffer from pool to reduce GC pressure
        var buffer = _arrayPool.Rent(chunkSize);
        try
        {
            while (bytesRead < bytesToRead)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var bytesRemaining = bytesToRead - bytesRead;
                var bytesToReadThisChunk = (int)Math.Min(chunkSize, bytesRemaining);

                var readCount = await fileStream.ReadAsync(
                    buffer.AsMemory(0, bytesToReadThisChunk),
                    cancellationToken).ConfigureAwait(false);

                if (readCount == 0)
                {
                    break; // End of file
                }

                bytesRead += readCount;

                // Report progress
                if (progressCallback is not null)
                {
                    await progressCallback(bytesRead, bytesToRead).ConfigureAwait(false);
                }

                // Return exact bytes read (the rented buffer may be larger than chunkSize)
                if (readCount == bytesToReadThisChunk && readCount == chunkSize)
                {
                    // Full chunk - create a copy since we're reusing the buffer
                    var chunk = new byte[readCount];
                    Buffer.BlockCopy(buffer, 0, chunk, 0, readCount);
                    yield return chunk;
                }
                else
                {
                    // Partial chunk (last chunk or smaller than buffer)
                    var chunk = new byte[readCount];
                    Buffer.BlockCopy(buffer, 0, chunk, 0, readCount);
                    yield return chunk;
                }
            }
        }
        finally
        {
            _arrayPool.Return(buffer);
        }

        // Report 100% completion if not already
        if (progressCallback is not null && bytesRead > 0)
        {
            await progressCallback(bytesRead, bytesToRead).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Streams file content using Pipelines for maximum performance with zero-copy reads.
    /// Ideal for very large files (>100MB).
    /// </summary>
    /// <param name="filePath">The absolute path to the file to stream.</param>
    /// <param name="minBufferSize">Minimum buffer size for pipeline segments.</param>
    /// <param name="startOffset">Byte offset to start reading from.</param>
    /// <param name="endOffset">Byte offset to stop reading at (-1 for end of file).</param>
    /// <param name="cancellationToken">Token to cancel the streaming operation.</param>
    /// <returns>An async enumerable of ReadOnlyMemory segments (zero-copy when possible).</returns>
    public async IAsyncEnumerable<ReadOnlyMemory<byte>> ReadFilePipelineAsync(
        string filePath,
        int minBufferSize = DefaultChunkSize,
        long startOffset = 0,
        long endOffset = -1,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        ObjectDisposedException.ThrowIf(_disposed, this);

        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("File path cannot be null or empty.", nameof(filePath));
        }

        if (!File.Exists(filePath))
        {
            throw new FileNotFoundException($"File not found: {filePath}", filePath);
        }

        var fileInfo = new FileInfo(filePath);
        var totalBytes = fileInfo.Length;

        if (startOffset < 0 || startOffset >= totalBytes)
        {
            throw new ArgumentOutOfRangeException(nameof(startOffset));
        }

        var effectiveEnd = endOffset < 0 ? totalBytes : Math.Min(endOffset + 1, totalBytes);
        if (effectiveEnd <= startOffset)
        {
            throw new ArgumentOutOfRangeException(nameof(endOffset));
        }

        var bytesToRead = effectiveEnd - startOffset;

        await using var fileStream = new FileStream(
            filePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: minBufferSize,
            options: FileOptions.Asynchronous | FileOptions.SequentialScan);

        if (startOffset > 0)
        {
            fileStream.Seek(startOffset, SeekOrigin.Begin);
        }

        // Create a pipe with appropriate options
        var pipe = new Pipe(new PipeOptions(
            pool: MemoryPool<byte>.Shared,
            minimumSegmentSize: minBufferSize,
            pauseWriterThreshold: minBufferSize * 4,
            resumeWriterThreshold: minBufferSize * 2));

        // Start filling the pipe from the file
        var fillTask = FillPipeAsync(fileStream, pipe.Writer, bytesToRead, cancellationToken);

        // Read from the pipe and yield chunks
        long bytesYielded = 0;

        try
        {
            while (bytesYielded < bytesToRead)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var readResult = await pipe.Reader.ReadAsync(cancellationToken).ConfigureAwait(false);
                var buffer = readResult.Buffer;

                if (buffer.IsEmpty && readResult.IsCompleted)
                {
                    break;
                }

                foreach (var segment in buffer)
                {
                    if (segment.IsEmpty) continue;

                    var bytesRemaining = bytesToRead - bytesYielded;
                    if (bytesRemaining <= 0) break;

                    var chunk = segment.Length <= (int)bytesRemaining
                        ? segment
                        : segment.Slice(0, (int)bytesRemaining);

                    // Copy to owned memory since we're advancing the reader
                    var owned = new byte[chunk.Length];
                    chunk.CopyTo(owned);
                    yield return owned;

                    bytesYielded += chunk.Length;
                    if (bytesYielded >= bytesToRead) break;
                }

                pipe.Reader.AdvanceTo(buffer.End);

                if (readResult.IsCompleted)
                {
                    break;
                }
            }
        }
        finally
        {
            await pipe.Reader.CompleteAsync();
            await fillTask.ConfigureAwait(false);
        }
    }

    private static async Task FillPipeAsync(
        FileStream fileStream,
        PipeWriter writer,
        long bytesToRead,
        CancellationToken cancellationToken)
    {
        long bytesWritten = 0;

        try
        {
            while (bytesWritten < bytesToRead)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var memory = writer.GetMemory(DefaultChunkSize);
                var bytesRemaining = bytesToRead - bytesWritten;
                var maxToRead = (int)Math.Min(memory.Length, bytesRemaining);

                var bytesRead = await fileStream.ReadAsync(
                    memory.Slice(0, maxToRead),
                    cancellationToken).ConfigureAwait(false);

                if (bytesRead == 0)
                {
                    break;
                }

                writer.Advance(bytesRead);
                bytesWritten += bytesRead;

                var flushResult = await writer.FlushAsync(cancellationToken).ConfigureAwait(false);
                if (flushResult.IsCanceled || flushResult.IsCompleted)
                {
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            await writer.CompleteAsync(ex);
            return;
        }

        await writer.CompleteAsync();
    }

    /// <summary>
    /// Gets file information without reading content.
    /// </summary>
    /// <param name="filePath">The absolute path to the file.</param>
    /// <returns>File information including size and last modified time.</returns>
    public static FileMetadata GetFileMetadata(string filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("File path cannot be null or empty.", nameof(filePath));
        }

        var fileInfo = new FileInfo(filePath);
        if (!fileInfo.Exists)
        {
            throw new FileNotFoundException($"File not found: {filePath}", filePath);
        }

        return new FileMetadata
        {
            Path = filePath,
            Size = fileInfo.Length,
            LastModified = fileInfo.LastWriteTimeUtc,
            CreatedAt = fileInfo.CreationTimeUtc,
            IsReadOnly = fileInfo.IsReadOnly
        };
    }

    /// <summary>
    /// Computes an ETag for cache validation.
    /// Uses file size and last modified time for a quick hash.
    /// </summary>
    public static string ComputeETag(string filePath)
    {
        var info = new FileInfo(filePath);
        if (!info.Exists)
        {
            throw new FileNotFoundException($"File not found: {filePath}", filePath);
        }

        // Use size + modified time ticks for a unique-ish identifier
        var hash = HashCode.Combine(info.Length, info.LastWriteTimeUtc.Ticks);
        return $"\"{hash:x}\"";
    }

    public void Dispose()
    {
        _disposed = true;
    }
}

/// <summary>
/// Metadata about a file for streaming.
/// </summary>
public readonly struct FileMetadata
{
    public string Path { get; init; }
    public long Size { get; init; }
    public DateTime LastModified { get; init; }
    public DateTime CreatedAt { get; init; }
    public bool IsReadOnly { get; init; }
}
