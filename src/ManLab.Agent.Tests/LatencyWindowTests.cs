using ManLab.Agent.Telemetry;
using Xunit;

namespace ManLab.Agent.Tests;

public sealed class LatencyWindowTests
{
    [Fact]
    public void GetStats_NoSamples_ReturnsEmpty()
    {
        var window = new EnhancedNetworkTelemetryCollector.LatencyWindow(size: 5);

        var stats = window.GetStats();

        Assert.Null(stats.PacketLossPercent);
        Assert.Null(stats.LastRtt);
        Assert.Null(stats.MinRtt);
        Assert.Null(stats.MaxRtt);
        Assert.Null(stats.AvgRtt);
        Assert.Null(stats.Jitter);
    }

    [Fact]
    public void GetStats_WithSamples_ComputesExpectedValues()
    {
        var window = new EnhancedNetworkTelemetryCollector.LatencyWindow(size: 5);

        window.AddSample(success: true, rttMs: 10);
        window.AddSample(success: true, rttMs: 20);
        window.AddSample(success: false, rttMs: null);

        var stats = window.GetStats();

        Assert.InRange(stats.PacketLossPercent ?? 0, 33.3f, 33.4f);
        Assert.Equal(20, stats.LastRtt);
        Assert.Equal(10, stats.MinRtt);
        Assert.Equal(20, stats.MaxRtt);
        Assert.InRange(stats.AvgRtt ?? 0, 14.9f, 15.1f);
        Assert.InRange(stats.Jitter ?? 0, 4.9f, 5.1f);
    }

    [Fact]
    public void GetStats_AllFailures_ReportsFullLoss()
    {
        var window = new EnhancedNetworkTelemetryCollector.LatencyWindow(size: 3);

        window.AddSample(success: false, rttMs: null);
        window.AddSample(success: false, rttMs: null);
        window.AddSample(success: false, rttMs: null);

        var stats = window.GetStats();

        Assert.Equal(100f, stats.PacketLossPercent);
        Assert.Null(stats.LastRtt);
        Assert.Null(stats.MinRtt);
        Assert.Null(stats.MaxRtt);
        Assert.Null(stats.AvgRtt);
        Assert.Null(stats.Jitter);
    }

    [Fact]
    public void GetStats_SingleSuccess_NoJitter()
    {
        var window = new EnhancedNetworkTelemetryCollector.LatencyWindow(size: 3);

        window.AddSample(success: true, rttMs: 42);

        var stats = window.GetStats();

        Assert.Equal(0f, stats.PacketLossPercent);
        Assert.Equal(42, stats.LastRtt);
        Assert.Equal(42, stats.MinRtt);
        Assert.Equal(42, stats.MaxRtt);
        Assert.Equal(42f, stats.AvgRtt);
        Assert.Null(stats.Jitter);
    }

    [Fact]
    public void GetStats_EvictsOldSamples()
    {
        var window = new EnhancedNetworkTelemetryCollector.LatencyWindow(size: 2);

        window.AddSample(success: true, rttMs: 10);
        window.AddSample(success: false, rttMs: null);
        window.AddSample(success: true, rttMs: 30); // evicts first sample

        var stats = window.GetStats();

        Assert.InRange(stats.PacketLossPercent ?? 0, 49.9f, 50.1f);
        Assert.Equal(30, stats.LastRtt);
        Assert.Equal(30, stats.MinRtt);
        Assert.Equal(30, stats.MaxRtt);
        Assert.Equal(30f, stats.AvgRtt);
    }
}
