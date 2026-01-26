using BenchmarkDotNet.Attributes;
using ManLab.Agent.Telemetry;

[MemoryDiagnoser]
public class LatencyWindowScenariosBenchmarks
{
    private EnhancedNetworkTelemetryCollector.LatencyWindow _windowSmall = null!;
    private EnhancedNetworkTelemetryCollector.LatencyWindow _windowMedium = null!;
    private EnhancedNetworkTelemetryCollector.LatencyWindow _windowLarge = null!;

    [GlobalSetup]
    public void Setup()
    {
        _windowSmall = CreateWindow(16, successRatePercent: 90);
        _windowMedium = CreateWindow(120, successRatePercent: 75);
        _windowLarge = CreateWindow(1000, successRatePercent: 50);
    }

    [Benchmark]
    public void GetStats_Small()
        => _windowSmall.GetStats();

    [Benchmark]
    public void GetStats_Medium()
        => _windowMedium.GetStats();

    [Benchmark]
    public void GetStats_Large()
        => _windowLarge.GetStats();

    [Benchmark]
    public void AddSample_Small()
        => _windowSmall.AddSample(success: true, rttMs: 12);

    [Benchmark]
    public void AddSample_Large()
        => _windowLarge.AddSample(success: false, rttMs: null);

    private static EnhancedNetworkTelemetryCollector.LatencyWindow CreateWindow(int size, int successRatePercent)
    {
        var window = new EnhancedNetworkTelemetryCollector.LatencyWindow(size);
        var rnd = new Random(1234 + size + successRatePercent);

        for (var i = 0; i < size; i++)
        {
            var success = rnd.Next(0, 100) < successRatePercent;
            var rtt = success ? 5 + rnd.Next(0, 50) : (long?)null;
            window.AddSample(success, rtt);
        }

        return window;
    }
}
