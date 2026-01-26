using BenchmarkDotNet.Attributes;
using ManLab.Agent.Services;

[MemoryDiagnoser]
public class ChunkedFileReaderPipelineBenchmarks
{
    private string _filePath = string.Empty;
    private ChunkedFileReader _reader = null!;

    [GlobalSetup]
    public void Setup()
    {
        _reader = new ChunkedFileReader();
        _filePath = Path.Combine(Path.GetTempPath(), $"manlab-bench-pipe-{Guid.NewGuid():N}.bin");

        var data = new byte[16 * 1024 * 1024]; // 16MB file
        new Random(5678).NextBytes(data);
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
    public async Task ReadChunks_256KB()
    {
        await foreach (var _ in _reader.ReadFileChunksAsync(_filePath, chunkSize: 256 * 1024))
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

    [Benchmark]
    public async Task ReadPipeline_256KB()
    {
        await foreach (var _ in _reader.ReadFilePipelineAsync(_filePath, minBufferSize: 256 * 1024))
        {
        }
    }

    [Benchmark]
    public async Task ReadPipeline_1MB()
    {
        await foreach (var _ in _reader.ReadFilePipelineAsync(_filePath, minBufferSize: 1024 * 1024))
        {
        }
    }
}
