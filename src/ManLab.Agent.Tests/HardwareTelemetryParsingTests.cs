using ManLab.Agent.Telemetry;
using Xunit;

namespace ManLab.Agent.Tests;

public class HardwareTelemetryParsingTests
{
    [Fact]
    public void NvidiaSmiCsv_ParsesBasicFields_AndConvertsMiBToBytes()
    {
        var csv = "0, NVIDIA GeForce RTX 3080, 12, 1000, 10024, 55\n";

        var gpus = GpuTelemetryCollector.ParseNvidiaSmiCsv(csv);

        var gpu = Assert.Single(gpus);
        Assert.Equal("nvidia", gpu.Vendor);
        Assert.Equal(0, gpu.Index);
        Assert.Equal("NVIDIA GeForce RTX 3080", gpu.Name);
        Assert.Equal(12f, gpu.UtilizationPercent);
        Assert.Equal(1000L * 1024L * 1024L, gpu.MemoryUsedBytes);
        Assert.Equal(10024L * 1024L * 1024L, gpu.MemoryTotalBytes);
        Assert.Equal(55f, gpu.TemperatureC);
    }

    [Fact]
    public void Upsc_ParsesDeviceList_FirstLine()
    {
        var list = "ups@localhost\notherups@localhost\n";
        Assert.Equal("ups@localhost", UpsTelemetryCollector.ParseFirstUpscDeviceList(list));
    }

    [Fact]
    public void UpscOutput_ParsesCommonKeys()
    {
        var output = string.Join("\n", new[]
        {
            "battery.charge: 97",
            "ups.load: 12",
            "ups.status: OL",
            "battery.runtime: 1800"
        });

        var ups = UpsTelemetryCollector.ParseUpscOutput(output);
        Assert.NotNull(ups);
        Assert.Equal("nut", ups!.Backend);
        Assert.Equal(97f, ups.BatteryPercent);
        Assert.Equal(12f, ups.LoadPercent);
        Assert.False(ups.OnBattery);
        Assert.Equal(1800, ups.EstimatedRuntimeSeconds);
    }

    [Fact]
    public void ApcaccessStatus_ParsesCommonKeys_AndConvertsMinutesToSeconds()
    {
        var output = string.Join("\n", new[]
        {
            "STATUS   : ONLINE",
            "BCHARGE  : 100.0 Percent",
            "LOADPCT  : 7.0 Percent",
            "TIMELEFT : 15.0 Minutes"
        });

        var ups = UpsTelemetryCollector.ParseApcaccessStatus(output);
        Assert.NotNull(ups);
        Assert.Equal("apcupsd", ups!.Backend);
        Assert.Equal(100.0f, ups.BatteryPercent);
        Assert.Equal(7.0f, ups.LoadPercent);
        Assert.False(ups.OnBattery);
        Assert.Equal(900, ups.EstimatedRuntimeSeconds);
    }
}
