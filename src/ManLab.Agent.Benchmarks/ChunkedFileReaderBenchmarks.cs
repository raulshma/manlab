using BenchmarkDotNet.Attributes;
using ManLab.Agent.Services;

[MemoryDiagnoser]
public class ChunkedFileReaderBenchmarks
{
    private string _filePath = string.Empty;
    private ChunkedFileReader _reader = null!;

    [GlobalSetup]
    public void Setup()
    {
        _reader = new ChunkedFileReader();
        _filePath = Path.Combine(Path.GetTempPath(), $"manlab-bench-{Guid.NewGuid():N}.bin");

        var data = new byte[4 * 1024 * 1024]; // 4MB file
        new Random(1234).NextBytes(data);
        File.WriteAllBytes(_filePath, data);
    }

    [GlobalCleanup]
    public void Cleanup()
    {
        _reader.Dispose();
        if (File.Exists(_filePath))
        {
            File.Delete(_filePath);
        }
    }

    [Benchmark]
    public async Task ReadChunks_64KB()
    {
        await foreach (var _ in _reader.ReadFileChunksAsync(_filePath, chunkSize: 64 * 1024))
        {
        }
    }

    [Benchmark]
    public async Task ReadChunks_1MB()
    {
        await foreach (var _ in _reader.ReadFileChunksAsync(_filePath, chunkSize: 1024 * 1024))
        {
        }
    }
}
