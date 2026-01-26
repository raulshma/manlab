using BenchmarkDotNet.Attributes;
using ManLab.Agent.Telemetry;

[MemoryDiagnoser]
public class LatencyWindowBenchmarks
{
    private EnhancedNetworkTelemetryCollector.LatencyWindow _window = null!;

    [GlobalSetup]
    public void Setup()
    {
        _window = new EnhancedNetworkTelemetryCollector.LatencyWindow(size: 120);
        for (var i = 0; i < 120; i++)
        {
            var success = i % 5 != 0;
            var rtt = success ? 5 + (i % 40) : (long?)null;
            _window.AddSample(success, rtt);
        }
    }

    [Benchmark]
    public void GetStats()
        => _window.GetStats();

    [Benchmark]
    public void AddSample()
        => _window.AddSample(success: true, rttMs: 15);
}
