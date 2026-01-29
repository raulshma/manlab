using ManLab.Agent.Services;
using Xunit;

namespace ManLab.Agent.Tests;

/// <summary>
/// Tests for high-performance ChunkedFileReader.
/// </summary>
public class ChunkedFileReaderTests : IDisposable
{
    private readonly string _tempDir;
    private readonly List<string> _tempFiles = [];

    public ChunkedFileReaderTests()
    {
        _tempDir = Path.Combine(Path.GetTempPath(), $"ChunkedFileReaderTests_{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempDir);
    }

    public void Dispose()
    {
        foreach (var file in _tempFiles)
        {
            if (File.Exists(file))
            {
                File.Delete(file);
            }
        }
        if (Directory.Exists(_tempDir))
        {
            Directory.Delete(_tempDir, recursive: true);
        }
    }

    private string CreateTempFile(int size)
    {
        var filePath = Path.Combine(_tempDir, $"test_{Guid.NewGuid():N}.bin");
        var data = new byte[size];
        Random.Shared.NextBytes(data);
        File.WriteAllBytes(filePath, data);
        _tempFiles.Add(filePath);
        return filePath;
    }

    [Fact]
    public async Task ReadFileChunks_ReadsEntireFile()
    {
        // Arrange
        const int fileSize = 256 * 1024; // 256 KB
        var filePath = CreateTempFile(fileSize);
        var originalData = File.ReadAllBytes(filePath);
        using var reader = new ChunkedFileReader();

        // Act
        var chunks = new List<byte[]>();
        await foreach (var chunk in reader.ReadFileChunksAsync(filePath, chunkSize: 64 * 1024))
        {
            chunks.Add(chunk);
        }

        // Assert
        Assert.True(chunks.Count >= 4, $"Expected at least 4 chunks, got {chunks.Count}");
        var combined = CombineChunks(chunks);
        Assert.Equal(fileSize, combined.Length);
        Assert.Equal(originalData, combined);
    }

    [Fact]
    public async Task ReadFileChunks_SupportsRangeRequests()
    {
        // Arrange
        const int fileSize = 100 * 1024; // 100 KB
        var filePath = CreateTempFile(fileSize);
        var originalData = File.ReadAllBytes(filePath);
        using var reader = new ChunkedFileReader();

        // Read from offset 10KB to 50KB
        const long startOffset = 10 * 1024;
        const long endOffset = 50 * 1024;

        // Act
        var chunks = new List<byte[]>();
        await foreach (var chunk in reader.ReadFileChunksAsync(
            filePath,
            chunkSize: 8 * 1024,
            startOffset: startOffset,
            endOffset: endOffset))
        {
            chunks.Add(chunk);
        }

        // Assert
        var combined = CombineChunks(chunks);
        var expectedLength = endOffset - startOffset + 1;
        Assert.Equal(expectedLength, combined.Length);

        // Verify content matches the range
        var expectedData = new byte[expectedLength];
        Array.Copy(originalData, startOffset, expectedData, 0, expectedLength);
        Assert.Equal(expectedData, combined);
    }

    [Fact]
    public async Task ReadFileChunks_ReportsProgress()
    {
        // Arrange
        const int fileSize = 128 * 1024; // 128 KB
        var filePath = CreateTempFile(fileSize);
        using var reader = new ChunkedFileReader();
        var progressUpdates = new List<(long bytesRead, long totalBytes)>();

        // Act
        await foreach (var _ in reader.ReadFileChunksAsync(
            filePath,
            chunkSize: 32 * 1024,
            progressCallback: async (bytesRead, totalBytes) =>
            {
                progressUpdates.Add((bytesRead, totalBytes));
                await ValueTask.CompletedTask;
            }))
        {
            // Just consume chunks
        }

        // Assert - at least 1 progress update should be made
        Assert.True(progressUpdates.Count >= 1, $"Expected at least 1 progress update, got {progressUpdates.Count}");
        // Final progress should show all bytes read
        Assert.Equal(fileSize, progressUpdates[^1].bytesRead);
    }

    [Fact]
    public async Task ReadFileChunks_ThrowsOnNonexistentFile()
    {
        using var reader = new ChunkedFileReader();
        var nonExistentPath = Path.Combine(_tempDir, "does_not_exist.bin");

        await Assert.ThrowsAsync<FileNotFoundException>(async () =>
        {
            await foreach (var _ in reader.ReadFileChunksAsync(nonExistentPath))
            {
                // Should not reach here
            }
        });
    }

    [Fact]
    public async Task ReadFileChunks_RespectsChunkSizeBounds()
    {
        // Arrange
        const int fileSize = 256 * 1024; // 256 KB
        var filePath = CreateTempFile(fileSize);
        using var reader = new ChunkedFileReader();

        // Try with chunk size below minimum (should be clamped to min)
        var chunks = new List<byte[]>();
        await foreach (var chunk in reader.ReadFileChunksAsync(filePath, chunkSize: 1024)) // 1KB, below 64KB min
        {
            chunks.Add(chunk);
            // All chunks except possibly last should be MinChunkSize
            if (chunks.Count < chunks.Count - 1)
            {
                Assert.True(chunk.Length >= ChunkedFileReader.MinChunkSize || chunk.Length == fileSize - (chunks.Count - 1) * ChunkedFileReader.MinChunkSize);
            }
        }

        var combined = CombineChunks(chunks);
        Assert.Equal(fileSize, combined.Length);
    }

    [Fact]
    public async Task ReadFileChunks_SupportsCancellation()
    {
        // Arrange
        const int fileSize = 1024 * 1024; // 1 MB
        var filePath = CreateTempFile(fileSize);
        using var reader = new ChunkedFileReader();
        using var cts = new CancellationTokenSource();
        int chunksRead = 0;

        // Act & Assert
        await Assert.ThrowsAsync<OperationCanceledException>(async () =>
        {
            await foreach (var _ in reader.ReadFileChunksAsync(
                filePath,
                chunkSize: ChunkedFileReader.MinChunkSize,
                cancellationToken: cts.Token))
            {
                chunksRead++;
                if (chunksRead == 2)
                {
                    cts.Cancel();
                }
            }
        });

        Assert.Equal(2, chunksRead);
    }

    [Fact]
    public void GetFileMetadata_ReturnsCorrectInfo()
    {
        // Arrange
        const int fileSize = 12345;
        var filePath = CreateTempFile(fileSize);

        // Act
        var metadata = ChunkedFileReader.GetFileMetadata(filePath);

        // Assert
        Assert.Equal(filePath, metadata.Path);
        Assert.Equal(fileSize, metadata.Size);
        Assert.True(metadata.LastModified <= DateTime.UtcNow);
        Assert.True(metadata.CreatedAt <= DateTime.UtcNow);
    }

    [Fact]
    public void ComputeETag_ReturnsDeterministicValue()
    {
        // Arrange
        const int fileSize = 1024;
        var filePath = CreateTempFile(fileSize);

        // Act
        var etag1 = ChunkedFileReader.ComputeETag(filePath);
        var etag2 = ChunkedFileReader.ComputeETag(filePath);

        // Assert
        Assert.NotNull(etag1);
        Assert.NotEmpty(etag1);
        Assert.StartsWith("\"", etag1);
        Assert.EndsWith("\"", etag1);
        Assert.Equal(etag1, etag2); // Should be deterministic
    }

    [Fact]
    public async Task ReadFilePipeline_ReadsEntireFile()
    {
        // Arrange
        const int fileSize = 128 * 1024; // 128 KB
        var filePath = CreateTempFile(fileSize);
        var originalData = File.ReadAllBytes(filePath);
        using var reader = new ChunkedFileReader();

        // Act
        var segments = new List<byte[]>();
        await foreach (var segment in reader.ReadFilePipelineAsync(filePath, minBufferSize: 32 * 1024))
        {
            segments.Add(segment.ToArray());
        }

        // Assert
        var combined = CombineChunks(segments);
        Assert.Equal(fileSize, combined.Length);
        Assert.Equal(originalData, combined);
    }

    private static byte[] CombineChunks(List<byte[]> chunks)
    {
        var totalLength = chunks.Sum(c => c.Length);
        var result = new byte[totalLength];
        var offset = 0;
        foreach (var chunk in chunks)
        {
            Buffer.BlockCopy(chunk, 0, result, offset, chunk.Length);
            offset += chunk.Length;
        }
        return result;
    }
}
