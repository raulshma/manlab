using System.Runtime.InteropServices;
using ManLab.Agent.Configuration;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;
using System.Net.Http;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Service that periodically collects telemetry data and sends it to the server.
/// </summary>
public sealed class TelemetryService : IAsyncDisposable
{
    private readonly ILogger<TelemetryService> _logger;
    private readonly ITelemetryCollector _collector;
    private readonly AgentConfiguration _config;
    private readonly Func<TelemetryData, Task> _sendTelemetry;
    private readonly Func<bool>? _shouldSendTelemetry;
    private readonly CancellationTokenSource _cts = new();
    private PeriodicTimer? _timer;
    private Task? _runningTask;

    public TelemetryService(
        ILoggerFactory loggerFactory,
        AgentConfiguration config,
        Func<TelemetryData, Task> sendTelemetry,
        Func<bool>? shouldSendTelemetry = null,
        IHttpClientFactory? httpClientFactory = null)
    {
        _logger = loggerFactory.CreateLogger<TelemetryService>();
        _config = config;
        _sendTelemetry = sendTelemetry;
        _shouldSendTelemetry = shouldSendTelemetry;

        // Select the appropriate collector based on the current platform
        _collector = CreateCollector(loggerFactory, config, httpClientFactory);
        _logger.LogInformation("Telemetry collector initialized for {OS}", GetOSName());
    }

    private static ITelemetryCollector CreateCollector(ILoggerFactory loggerFactory, AgentConfiguration config, IHttpClientFactory? httpClientFactory)
    {
        // Use a default HttpClientFactory if none is provided (for testing/backward compatibility)
        httpClientFactory ??= new DefaultHttpClientFactory();

        if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
        {
            return new WindowsTelemetryCollector(
                loggerFactory.CreateLogger<WindowsTelemetryCollector>(),
                config,
                httpClientFactory);
        }
        else if (RuntimeInformation.IsOSPlatform(OSPlatform.Linux))
        {
            return new LinuxTelemetryCollector(
                loggerFactory.CreateLogger<LinuxTelemetryCollector>(),
                config,
                httpClientFactory);
        }
        else
        {
            return new LinuxTelemetryCollector(
                loggerFactory.CreateLogger<LinuxTelemetryCollector>(),
                config,
                httpClientFactory);
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

        _timer = new PeriodicTimer(TimeSpan.FromSeconds(_config.HeartbeatIntervalSeconds));
        _runningTask = RunAsync(_cts.Token);
        _logger.LogInformation("Telemetry service started (interval: {Interval}s)", _config.HeartbeatIntervalSeconds);
        Log.TelemetryServiceStarted(_logger, _config.HeartbeatIntervalSeconds);
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

        await _cts.CancelAsync().ConfigureAwait(false);

        try
        {
            await _runningTask.ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // Expected
        }

        _timer?.Dispose();
        _timer = null;
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

        if (_timer is null) return;

        try
        {
            while (await _timer.WaitForNextTickAsync(cancellationToken).ConfigureAwait(false))
            {
                try
                {
                    if (_shouldSendTelemetry is not null && !_shouldSendTelemetry())
                    {
                        // Stay quiet while offline to reduce resource usage.
                        continue;
                    }

                    var data = _collector.Collect();

                    Log.TelemetryCollected(_logger, data.CpuPercent, data.RamUsedBytes / 1024 / 1024, data.RamTotalBytes / 1024 / 1024, data.DiskUsage.Count);

                    await _sendTelemetry(data).ConfigureAwait(false);
                }
                catch (Exception ex) when (ex is not OperationCanceledException)
                {
                    Log.TelemetryLoopError(_logger, ex);
                }
            }
        }
        catch (OperationCanceledException)
        {
            // Expected on shutdown
        }
    }

    public async ValueTask DisposeAsync()
    {
        await StopAsync().ConfigureAwait(false);
        _cts.Dispose();
    }
}

/// <summary>
/// Default implementation of IHttpClientFactory for backward compatibility.
/// Uses a shared HttpClient instance to avoid socket exhaustion issues.
/// </summary>
internal sealed class DefaultHttpClientFactory : IHttpClientFactory
{
    private readonly Lazy<HttpClient> _lazyClient = new(() => new HttpClient
    {
        Timeout = TimeSpan.FromSeconds(30)
    });

    public HttpClient CreateClient(string name)
    {
        // Return a shared HttpClient instance to avoid socket exhaustion
        // This is a simple implementation for the Agent which doesn't use DI
        // In production Server, IHttpClientFactory from DI should be used
        return _lazyClient.Value;
    }
}
