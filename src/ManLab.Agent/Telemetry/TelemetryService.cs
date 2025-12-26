using System.Runtime.InteropServices;
using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Service that periodically collects telemetry data and sends it to the server.
/// </summary>
public class TelemetryService : IAsyncDisposable
{
    private readonly ILogger<TelemetryService> _logger;
    private readonly ITelemetryCollector _collector;
    private readonly AgentConfiguration _config;
    private readonly Func<TelemetryData, Task> _sendTelemetry;
    private readonly CancellationTokenSource _cts = new();
    private Task? _runningTask;

    public TelemetryService(
        ILoggerFactory loggerFactory,
        AgentConfiguration config,
        Func<TelemetryData, Task> sendTelemetry)
    {
        _logger = loggerFactory.CreateLogger<TelemetryService>();
        _config = config;
        _sendTelemetry = sendTelemetry;

        // Select the appropriate collector based on the current platform
        _collector = CreateCollector(loggerFactory);
        _logger.LogInformation("Telemetry collector initialized for {OS}", GetOSName());
    }

    private ITelemetryCollector CreateCollector(ILoggerFactory loggerFactory)
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return new WindowsTelemetryCollector(loggerFactory.CreateLogger<WindowsTelemetryCollector>());
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            return new LinuxTelemetryCollector(loggerFactory.CreateLogger<LinuxTelemetryCollector>());
        }
        else
        {
            _logger.LogWarning("Unsupported platform {OS}, using Linux collector as fallback", GetOSName());
            return new LinuxTelemetryCollector(loggerFactory.CreateLogger<LinuxTelemetryCollector>());
        }
    }

    private static string GetOSName()
    {
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows)) return "Windows";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux)) return "Linux";
        if (RuntimeInformation.IsOSPlatform(OSPlatform.OSX)) return "macOS";
        return "Unknown";
    }

    /// <summary>
    /// Starts the telemetry collection loop.
    /// </summary>
    public void Start()
    {
        if (_runningTask != null)
        {
            _logger.LogWarning("Telemetry service is already running");
            return;
        }

        _runningTask = RunAsync(_cts.Token);
        _logger.LogInformation("Telemetry service started (interval: {Interval}s)", _config.HeartbeatIntervalSeconds);
    }

    /// <summary>
    /// Stops the telemetry collection loop.
    /// </summary>
    public async Task StopAsync()
    {
        if (_runningTask == null)
        {
            return;
        }

        _cts.Cancel();

        try
        {
            await _runningTask;
        }
        catch (OperationCanceledException)
        {
            // Expected
        }

        _runningTask = null;
        _logger.LogInformation("Telemetry service stopped");
    }

    /// <summary>
    /// Collects telemetry data immediately and returns it.
    /// </summary>
    public TelemetryData CollectNow()
    {
        return _collector.Collect();
    }

    private async Task RunAsync(CancellationToken cancellationToken)
    {
        // Initial collection to warm up the CPU usage calculation
        _ = _collector.Collect();

        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(_config.HeartbeatIntervalSeconds), cancellationToken);

                var data = _collector.Collect();
                
                _logger.LogDebug("Telemetry collected - CPU: {Cpu:F1}%, RAM: {Ram}/{Total} MB, Disks: {DiskCount}",
                    data.CpuPercent,
                    data.RamUsedBytes / 1024 / 1024,
                    data.RamTotalBytes / 1024 / 1024,
                    data.DiskUsage.Count);

                await _sendTelemetry(data);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Error in telemetry loop, will retry");
            }
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync();
        _cts.Dispose();
    }
}
