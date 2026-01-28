using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Enums;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Retention;

/// <summary>
/// Background service that aggregates telemetry snapshots into hourly and daily rollups.
/// </summary>
public sealed class TelemetryRollupService : BackgroundService
{
    private static readonly TimeSpan InitialDelay = TimeSpan.FromSeconds(10);
    private readonly ILogger<TelemetryRollupService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IOptionsMonitor<TelemetryRollupOptions> _options;

    public TelemetryRollupService(
        ILogger<TelemetryRollupService> logger,
        IServiceScopeFactory scopeFactory,
        IOptionsMonitor<TelemetryRollupOptions> options)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _options = options;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        try
        {
            await Task.Delay(InitialDelay, stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await RollupOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Telemetry rollup failed");
            }

            var interval = TimeSpan.FromMinutes(Math.Max(5, _options.CurrentValue.RollupIntervalMinutes));
            try
            {
                await Task.Delay(interval, stoppingToken);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    private async Task RollupOnceAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var nodeIds = await db.Nodes.AsNoTracking().Select(n => n.Id).ToListAsync(cancellationToken);
        if (nodeIds.Count == 0)
        {
            return;
        }

        var now = DateTime.UtcNow;
        var currentHour = new DateTime(now.Year, now.Month, now.Day, now.Hour, 0, 0, DateTimeKind.Utc);
        var currentDay = new DateTime(now.Year, now.Month, now.Day, 0, 0, 0, DateTimeKind.Utc);

        foreach (var nodeId in nodeIds)
        {
            await RollupHourlyAsync(db, nodeId, currentHour, cancellationToken);
            await RollupDailyAsync(db, nodeId, currentDay, cancellationToken);
            
            await db.SaveChangesAsync(cancellationToken);
            db.ChangeTracker.Clear();
        }
    }

    private async Task RollupHourlyAsync(DataContext db, Guid nodeId, DateTime currentHour, CancellationToken ct)
    {
        var lastRollup = await db.TelemetryRollups
            .AsNoTracking()
            .Where(r => r.NodeId == nodeId && r.Granularity == TelemetryRollupGranularity.Hour)
            .OrderByDescending(r => r.BucketStartUtc)
            .Select(r => (DateTime?)r.BucketStartUtc)
            .FirstOrDefaultAsync(ct);

        var backfillDays = Math.Max(1, _options.CurrentValue.InitialBackfillDays);
        var start = lastRollup?.AddHours(1) ?? currentHour.AddDays(-backfillDays);
        var end = currentHour.AddHours(-1); // only completed hours

        if (start > end)
        {
            return;
        }

        var existingBuckets = await db.TelemetryRollups
            .AsNoTracking()
            .Where(r => r.NodeId == nodeId && r.Granularity == TelemetryRollupGranularity.Hour && r.BucketStartUtc >= start && r.BucketStartUtc <= end)
            .Select(r => r.BucketStartUtc)
            .ToListAsync(ct);

        var existing = existingBuckets.ToHashSet();

        var snapshots = await db.TelemetrySnapshots
            .AsNoTracking()
            .Where(t => t.NodeId == nodeId && t.Timestamp >= start && t.Timestamp < end.AddHours(1))
            .OrderBy(t => t.Timestamp)
            .ToListAsync(ct);

        if (snapshots.Count == 0)
        {
            return;
        }

        var buckets = snapshots
            .GroupBy(s => new DateTime(s.Timestamp.Year, s.Timestamp.Month, s.Timestamp.Day, s.Timestamp.Hour, 0, 0, DateTimeKind.Utc))
            .OrderBy(g => g.Key);

        foreach (var bucket in buckets)
        {
            if (bucket.Key < start || bucket.Key > end || existing.Contains(bucket.Key))
            {
                continue;
            }

            var rollup = BuildRollupFromSnapshots(nodeId, TelemetryRollupGranularity.Hour, bucket.Key, 3600, bucket);
            if (rollup is null)
            {
                continue;
            }

            db.TelemetryRollups.Add(rollup);
        }
    }

    private async Task RollupDailyAsync(DataContext db, Guid nodeId, DateTime currentDay, CancellationToken ct)
    {
        var lastRollup = await db.TelemetryRollups
            .AsNoTracking()
            .Where(r => r.NodeId == nodeId && r.Granularity == TelemetryRollupGranularity.Day)
            .OrderByDescending(r => r.BucketStartUtc)
            .Select(r => (DateTime?)r.BucketStartUtc)
            .FirstOrDefaultAsync(ct);

        var start = lastRollup?.AddDays(1) ?? currentDay.AddDays(-Math.Max(1, _options.CurrentValue.InitialBackfillDays));
        var end = currentDay.AddDays(-1); // only completed days

        if (start > end)
        {
            return;
        }

        var existingBuckets = await db.TelemetryRollups
            .AsNoTracking()
            .Where(r => r.NodeId == nodeId && r.Granularity == TelemetryRollupGranularity.Day && r.BucketStartUtc >= start && r.BucketStartUtc <= end)
            .Select(r => r.BucketStartUtc)
            .ToListAsync(ct);

        var existing = existingBuckets.ToHashSet();

        var hourly = await db.TelemetryRollups
            .AsNoTracking()
            .Where(r => r.NodeId == nodeId && r.Granularity == TelemetryRollupGranularity.Hour && r.BucketStartUtc >= start && r.BucketStartUtc < end.AddDays(1))
            .OrderBy(r => r.BucketStartUtc)
            .ToListAsync(ct);

        if (hourly.Count == 0)
        {
            return;
        }

        var buckets = hourly
            .GroupBy(r => new DateTime(r.BucketStartUtc.Year, r.BucketStartUtc.Month, r.BucketStartUtc.Day, 0, 0, 0, DateTimeKind.Utc))
            .OrderBy(g => g.Key);

        foreach (var bucket in buckets)
        {
            if (bucket.Key < start || bucket.Key > end || existing.Contains(bucket.Key))
            {
                continue;
            }

            var rollup = BuildRollupFromHourly(nodeId, bucket.Key, bucket);
            if (rollup is null)
            {
                continue;
            }

            db.TelemetryRollups.Add(rollup);
        }
    }

    private static TelemetryRollup? BuildRollupFromSnapshots(
        Guid nodeId,
        TelemetryRollupGranularity granularity,
        DateTime bucketStart,
        int bucketSeconds,
        IEnumerable<TelemetrySnapshot> snapshots)
    {
        var list = snapshots.ToList();
        if (list.Count == 0)
        {
            return null;
        }

        return new TelemetryRollup
        {
            NodeId = nodeId,
            Granularity = granularity,
            BucketStartUtc = bucketStart,
            BucketSeconds = bucketSeconds,
            SampleCount = list.Count,

            CpuAvg = Avg(list.Select(s => (float?)s.CpuUsage)),
            CpuMin = Min(list.Select(s => (float?)s.CpuUsage)),
            CpuMax = Max(list.Select(s => (float?)s.CpuUsage)),
            CpuP95 = P95(list.Select(s => (float?)s.CpuUsage)),

            RamAvg = Avg(list.Select(s => (float?)s.RamUsage)),
            RamMin = Min(list.Select(s => (float?)s.RamUsage)),
            RamMax = Max(list.Select(s => (float?)s.RamUsage)),
            RamP95 = P95(list.Select(s => (float?)s.RamUsage)),

            DiskAvg = Avg(list.Select(s => (float?)s.DiskUsage)),
            DiskMin = Min(list.Select(s => (float?)s.DiskUsage)),
            DiskMax = Max(list.Select(s => (float?)s.DiskUsage)),
            DiskP95 = P95(list.Select(s => (float?)s.DiskUsage)),

            TempAvg = Avg(list.Select(s => s.Temperature)),
            TempMin = Min(list.Select(s => s.Temperature)),
            TempMax = Max(list.Select(s => s.Temperature)),
            TempP95 = P95(list.Select(s => s.Temperature)),

            NetRxAvg = Avg(list.Select(s => s.NetRxBytesPerSec)),
            NetRxMax = Max(list.Select(s => s.NetRxBytesPerSec)),
            NetRxP95 = P95(list.Select(s => s.NetRxBytesPerSec)),

            NetTxAvg = Avg(list.Select(s => s.NetTxBytesPerSec)),
            NetTxMax = Max(list.Select(s => s.NetTxBytesPerSec)),
            NetTxP95 = P95(list.Select(s => s.NetTxBytesPerSec)),

            PingRttAvg = Avg(list.Select(s => s.PingRttMs)),
            PingRttMax = Max(list.Select(s => s.PingRttMs)),
            PingRttP95 = P95(list.Select(s => s.PingRttMs)),

            PingLossAvg = Avg(list.Select(s => s.PingPacketLossPercent)),
            PingLossMax = Max(list.Select(s => s.PingPacketLossPercent)),
            PingLossP95 = P95(list.Select(s => s.PingPacketLossPercent))
        };
    }

    private static TelemetryRollup? BuildRollupFromHourly(Guid nodeId, DateTime bucketStart, IEnumerable<TelemetryRollup> hourly)
    {
        var list = hourly.ToList();
        if (list.Count == 0)
        {
            return null;
        }

        return new TelemetryRollup
        {
            NodeId = nodeId,
            Granularity = TelemetryRollupGranularity.Day,
            BucketStartUtc = bucketStart,
            BucketSeconds = 86400,
            SampleCount = list.Sum(r => r.SampleCount),

            CpuAvg = WeightedAvg(list.Select(r => (r.CpuAvg, r.SampleCount))),
            CpuMin = Min(list.Select(r => r.CpuMin)),
            CpuMax = Max(list.Select(r => r.CpuMax)),
            CpuP95 = Max(list.Select(r => r.CpuP95)),

            RamAvg = WeightedAvg(list.Select(r => (r.RamAvg, r.SampleCount))),
            RamMin = Min(list.Select(r => r.RamMin)),
            RamMax = Max(list.Select(r => r.RamMax)),
            RamP95 = Max(list.Select(r => r.RamP95)),

            DiskAvg = WeightedAvg(list.Select(r => (r.DiskAvg, r.SampleCount))),
            DiskMin = Min(list.Select(r => r.DiskMin)),
            DiskMax = Max(list.Select(r => r.DiskMax)),
            DiskP95 = Max(list.Select(r => r.DiskP95)),

            TempAvg = WeightedAvg(list.Select(r => (r.TempAvg, r.SampleCount))),
            TempMin = Min(list.Select(r => r.TempMin)),
            TempMax = Max(list.Select(r => r.TempMax)),
            TempP95 = Max(list.Select(r => r.TempP95)),

            NetRxAvg = WeightedAvg(list.Select(r => (r.NetRxAvg, r.SampleCount))),
            NetRxMax = Max(list.Select(r => r.NetRxMax)),
            NetRxP95 = Max(list.Select(r => r.NetRxP95)),

            NetTxAvg = WeightedAvg(list.Select(r => (r.NetTxAvg, r.SampleCount))),
            NetTxMax = Max(list.Select(r => r.NetTxMax)),
            NetTxP95 = Max(list.Select(r => r.NetTxP95)),

            PingRttAvg = WeightedAvg(list.Select(r => (r.PingRttAvg, r.SampleCount))),
            PingRttMax = Max(list.Select(r => r.PingRttMax)),
            PingRttP95 = Max(list.Select(r => r.PingRttP95)),

            PingLossAvg = WeightedAvg(list.Select(r => (r.PingLossAvg, r.SampleCount))),
            PingLossMax = Max(list.Select(r => r.PingLossMax)),
            PingLossP95 = Max(list.Select(r => r.PingLossP95))
        };
    }

    private static float? Avg(IEnumerable<float?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => v.GetValueOrDefault()).ToList();
        return list.Count == 0 ? null : list.Average();
    }

    private static double? Avg(IEnumerable<long?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => (double)v.GetValueOrDefault()).ToList();
        return list.Count == 0 ? null : list.Average();
    }

    private static double? Avg(IEnumerable<double?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => v.GetValueOrDefault()).ToList();
        return list.Count == 0 ? null : list.Average();
    }

    private static float? Min(IEnumerable<float?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => v.GetValueOrDefault()).ToList();
        return list.Count == 0 ? null : list.Min();
    }

    private static double? Max(IEnumerable<double?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => v.GetValueOrDefault()).ToList();
        return list.Count == 0 ? null : list.Max();
    }

    private static double? Max(IEnumerable<long?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => (double)v.GetValueOrDefault()).ToList();
        return list.Count == 0 ? null : list.Max();
    }

    private static float? Max(IEnumerable<float?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => v.GetValueOrDefault()).ToList();
        return list.Count == 0 ? null : list.Max();
    }

    private static float? P95(IEnumerable<float?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => v.GetValueOrDefault()).OrderBy(v => v).ToList();
        if (list.Count == 0)
        {
            return null;
        }

        var index = (int)Math.Ceiling(0.95 * list.Count) - 1;
        index = Math.Clamp(index, 0, list.Count - 1);
        return list[index];
    }

    private static double? P95(IEnumerable<long?> values)
    {
        var list = values.Where(v => v.HasValue).Select(v => (double)v.GetValueOrDefault()).OrderBy(v => v).ToList();
        if (list.Count == 0)
        {
            return null;
        }

        var index = (int)Math.Ceiling(0.95 * list.Count) - 1;
        index = Math.Clamp(index, 0, list.Count - 1);
        return list[index];
    }

    private static float? WeightedAvg(IEnumerable<(float? Value, int Weight)> values)
    {
        double sum = 0;
        double weight = 0;
        foreach (var (value, w) in values)
        {
            if (value is null || w <= 0)
            {
                continue;
            }
            sum += value.GetValueOrDefault() * w;
            weight += w;
        }

        if (weight <= 0)
        {
            return null;
        }

        return (float)(sum / weight);
    }

    private static double? WeightedAvg(IEnumerable<(double? Value, int Weight)> values)
    {
        double sum = 0;
        double weight = 0;
        foreach (var (value, w) in values)
        {
            if (value is null || w <= 0)
            {
                continue;
            }
            sum += value.GetValueOrDefault() * w;
            weight += w;
        }

        if (weight <= 0)
        {
            return null;
        }

        return sum / weight;
    }
}
