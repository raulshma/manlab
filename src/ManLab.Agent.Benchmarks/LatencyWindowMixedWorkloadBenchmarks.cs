using BenchmarkDotNet.Attributes;
using ManLab.Agent.Telemetry;

[MemoryDiagnoser]
public class LatencyWindowMixedWorkloadBenchmarks
{
    private EnhancedNetworkTelemetryCollector.LatencyWindow _small = null!;
    private EnhancedNetworkTelemetryCollector.LatencyWindow _medium = null!;
    private EnhancedNetworkTelemetryCollector.LatencyWindow _large = null!;

    [GlobalSetup]
    public void Setup()
    {
        _small = CreateWindow(16);
        _medium = CreateWindow(120);
        _large = CreateWindow(1000);
    }

    [Benchmark]
    public void AddAndGet_Small()
    {
        _small.AddSample(success: true, rttMs: 12);
        _small.GetStats();
    }

    [Benchmark]
    public void AddAndGet_Medium()
    {
        _medium.AddSample(success: true, rttMs: 18);
        _medium.GetStats();
    }

    [Benchmark]
    public void AddAndGet_Large()
    {
        _large.AddSample(success: false, rttMs: null);
        _large.GetStats();
    }

    private static EnhancedNetworkTelemetryCollector.LatencyWindow CreateWindow(int size)
    {
        var window = new EnhancedNetworkTelemetryCollector.LatencyWindow(size);
        var rnd = new Random(4321 + size);

        for (var i = 0; i < size; i++)
        {
            var success = rnd.Next(0, 100) < 80;
            var rtt = success ? 5 + rnd.Next(0, 60) : (long?)null;
            window.AddSample(success, rtt);
        }

        return window;
    }
}
