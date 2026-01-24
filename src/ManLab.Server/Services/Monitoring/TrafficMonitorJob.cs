using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net.NetworkInformation;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Services.Network;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace ManLab.Server.Services.Monitoring;

[DisallowConcurrentExecution]
public sealed class TrafficMonitorJob : IJob
{
    private static readonly ConcurrentDictionary<string, InterfaceState> InterfaceStates = new();

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TrafficMonitorJob> _logger;
    private readonly INetworkToolHistoryService _history;

    public TrafficMonitorJob(
        IServiceScopeFactory scopeFactory,
        ILogger<TrafficMonitorJob> logger,
        INetworkToolHistoryService history)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _history = history;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        if (!context.MergedJobDataMap.TryGetValue("monitorId", out var idObj) ||
            !Guid.TryParse(idObj?.ToString(), out var monitorId))
        {
            _logger.LogWarning("Traffic monitor job executed without a valid monitorId");
            return;
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var config = await db.TrafficMonitorConfigs
            .FirstOrDefaultAsync(c => c.Id == monitorId, context.CancellationToken)
            .ConfigureAwait(false);

        if (config is null || !config.Enabled)
        {
            return;
        }

        var sw = Stopwatch.StartNew();
        var now = DateTime.UtcNow;
        var samples = new List<TrafficSample>();
        string? errorMessage = null;

        try
        {
            var interfaces = NetworkInterface.GetAllNetworkInterfaces()
                .Where(nic => nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .Where(nic => nic.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .Where(nic => string.IsNullOrWhiteSpace(config.InterfaceName) ||
                    string.Equals(nic.Name, config.InterfaceName, StringComparison.OrdinalIgnoreCase))
                .ToList();

            foreach (var nic in interfaces)
            {
                try
                {
                    var stats = nic.GetIPStatistics();
                    var stateKey = nic.Id;
                    var previous = InterfaceStates.TryGetValue(stateKey, out var prev) ? prev : null;

                    long? rxPerSec = null;
                    long? txPerSec = null;
                    float? utilization = null;

                    if (previous is not null)
                    {
                        var elapsed = (now - previous.TimestampUtc).TotalSeconds;
                        if (elapsed > 0)
                        {
                            rxPerSec = (long)((stats.BytesReceived - previous.RxBytes) / elapsed);
                            txPerSec = (long)((stats.BytesSent - previous.TxBytes) / elapsed);

                            if (nic.Speed > 0)
                            {
                                var totalBytesPerSec = ((stats.BytesReceived - previous.RxBytes) + (stats.BytesSent - previous.TxBytes)) / elapsed;
                                var maxBytesPerSec = nic.Speed / 8.0;
                                utilization = (float)Math.Min(100, (totalBytesPerSec / maxBytesPerSec) * 100);
                            }
                        }
                    }

                    InterfaceStates[stateKey] = new InterfaceState
                    {
                        RxBytes = stats.BytesReceived,
                        TxBytes = stats.BytesSent,
                        TimestampUtc = now
                    };

                    samples.Add(new TrafficSample
                    {
                        InterfaceName = nic.Name,
                        TimestampUtc = now,
                        RxBytesPerSec = rxPerSec,
                        TxBytesPerSec = txPerSec,
                        RxErrors = stats.IncomingPacketsWithErrors,
                        TxErrors = stats.OutgoingPacketsWithErrors,
                        SpeedBps = nic.Speed > 0 ? nic.Speed : null,
                        UtilizationPercent = utilization
                    });
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Failed to sample traffic for interface {Name}", nic.Name);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Traffic monitor sampling failed");
            errorMessage = ex.Message;
        }

        if (samples.Count > 0)
        {
            db.TrafficSamples.AddRange(samples);
        }

        config.LastRunAtUtc = now;
        config.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(context.CancellationToken).ConfigureAwait(false);
        sw.Stop();

        var avgRx = samples.Count > 0
            ? samples.Where(s => s.RxBytesPerSec.HasValue).Select(s => s.RxBytesPerSec!.Value).DefaultIfEmpty(0).Average()
            : 0;
        var avgTx = samples.Count > 0
            ? samples.Where(s => s.TxBytesPerSec.HasValue).Select(s => s.TxBytesPerSec!.Value).DefaultIfEmpty(0).Average()
            : 0;
        var maxUtilization = samples.Count > 0
            ? samples.Where(s => s.UtilizationPercent.HasValue).Select(s => s.UtilizationPercent!.Value).DefaultIfEmpty(0).Max()
            : 0;

        _ = _history.RecordAsync(
            toolType: "monitor-traffic",
            target: string.IsNullOrWhiteSpace(config.InterfaceName) ? "all" : config.InterfaceName,
            input: new
            {
                config.InterfaceName,
                config.Cron,
                config.Enabled
            },
            result: new
            {
                SampleCount = samples.Count,
                InterfaceCount = samples.Select(s => s.InterfaceName).Distinct(StringComparer.OrdinalIgnoreCase).Count(),
                AvgRxBytesPerSec = avgRx,
                AvgTxBytesPerSec = avgTx,
                MaxUtilizationPercent = maxUtilization
            },
            success: samples.Count > 0,
            durationMs: (int)sw.ElapsedMilliseconds,
            error: errorMessage);
    }

    private sealed class InterfaceState
    {
        public long RxBytes { get; init; }
        public long TxBytes { get; init; }
        public DateTime TimestampUtc { get; init; }
    }
}
