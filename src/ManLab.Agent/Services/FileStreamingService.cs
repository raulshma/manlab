using System.Runtime.CompilerServices;

namespace ManLab.Agent.Services;

/// <summary>
/// Handles streaming file content back to the server in chunks.
/// Designed for efficient large file transfers with progress reporting.
/// </summary>
public sealed class FileStreamingService
{
    /// <summary>
    /// Chunk size for file streaming (64KB).
    /// This size balances memory efficiency with transfer overhead.
    /// </summary>
    public const int ChunkSize = 64 * 1024;

    /// <summary>
    /// Streams file content as an async enumerable of byte chunks.
    /// </summary>
    /// <param name="filePath">The absolute path to the file to stream.</param>
    /// <param name="downloadId">The download session ID for tracking.</param>
    /// <param name="progressCallback">
    /// Callback invoked after each chunk with (bytesTransferred, totalBytes).
    /// Can be null if progress reporting is not needed.
    /// </param>
    /// <param name="cancellationToken">Token to cancel the streaming operation.</param>
    /// <returns>An async enumerable of byte array chunks.</returns>
    /// <exception cref="FileNotFoundException">Thrown if the file does not exist.</exception>
    /// <exception cref="OperationCanceledException">Thrown if cancellation is requested.</exception>
    public async IAsyncEnumerable<byte[]> StreamFileAsync(
        string filePath,
        Guid downloadId,
        Func<long, long, Task>? progressCallback,
        [EnumeratorCancellation] CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(filePath))
        {
            throw new ArgumentException("File path cannot be null or empty.", nameof(filePath));
        }

        if (!File.Exists(filePath))
        {
            throw new FileNotFoundException($"File not found: {filePath}", filePath);
        }

        await using var fs = new FileStream(
            filePath,
            FileMode.Open,
            FileAccess.Read,
            FileShare.Read,
            bufferSize: ChunkSize,
            useAsync: true);

        var totalBytes = fs.Length;
        var buffer = new byte[ChunkSize];
        long transferred = 0;

        while (true)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var read = await fs.ReadAsync(buffer.AsMemory(), cancellationToken).ConfigureAwait(false);
            if (read == 0)
            {
                break;
            }

            transferred += read;

            // Report progress after each chunk
            if (progressCallback is not null)
            {
                await progressCallback(transferred, totalBytes).ConfigureAwait(false);
            }

            // Yield the exact bytes read (avoid returning trailing zeros for partial chunks)
            if (read == ChunkSize)
            {
                yield return buffer;
                // Allocate a new buffer for the next iteration to avoid data corruption
                // if the consumer holds onto the previous chunk
                buffer = new byte[ChunkSize];
            }
            else
            {
                // Final partial chunk - return only the bytes that were read
                yield return buffer[..read];
            }
        }

        // If file was empty, still report completion
        if (totalBytes == 0 && progressCallback is not null)
        {
            await progressCallback(0, 0).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Gets the size of a file without reading its content.
    /// </summary>
    /// <param name="filePath">The absolute path to the file.</param>
    /// <returns>The file size in bytes.</returns>
    /// <exception cref="FileNotFoundException">Thrown if the file does not exist.</exception>
    public static long GetFileSize(string filePath)
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

        return fileInfo.Length;
    }
}
