using System.Diagnostics;
using System.Text.Json;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Services.Network;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace ManLab.Server.Services.Monitoring;

[DisallowConcurrentExecution]
public sealed class ScheduledNetworkToolJob : IJob
{
    private static readonly HashSet<string> SupportedToolTypes = new(StringComparer.OrdinalIgnoreCase)
    {
        "ping",
        "dns-lookup",
        "ssl-inspect",
        "public-ip",
        "traceroute"
    };

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly INetworkScannerService _scanner;
    private readonly INetworkToolHistoryService _history;
    private readonly ILogger<ScheduledNetworkToolJob> _logger;

    public ScheduledNetworkToolJob(
        IServiceScopeFactory scopeFactory,
        INetworkScannerService scanner,
        INetworkToolHistoryService history,
        ILogger<ScheduledNetworkToolJob> logger)
    {
        _scopeFactory = scopeFactory;
        _scanner = scanner;
        _history = history;
        _logger = logger;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        if (!context.MergedJobDataMap.TryGetValue("scheduleId", out var idObj) ||
            !Guid.TryParse(idObj?.ToString(), out var scheduleId))
        {
            _logger.LogWarning("Scheduled network tool executed without a valid scheduleId");
            return;
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var config = await db.ScheduledNetworkToolConfigs
            .FirstOrDefaultAsync(c => c.Id == scheduleId, context.CancellationToken)
            .ConfigureAwait(false);

        if (config is null || !config.Enabled)
        {
            return;
        }

        if (!SupportedToolTypes.Contains(config.ToolType))
        {
            _logger.LogWarning("Unsupported scheduled network tool type {ToolType}", config.ToolType);
            return;
        }

        var sw = Stopwatch.StartNew();
        bool success = false;
        object? result = null;
        string? errorMessage = null;

        try
        {
            switch (config.ToolType.ToLowerInvariant())
            {
                case "ping":
                {
                    var target = RequireTarget(config);
                    var parameters = ReadParameters<PingParameters>(config.ParametersJson);
                    var timeout = Math.Clamp(parameters?.TimeoutMs ?? 1000, 100, 10000);
                    var response = await _scanner.PingAsync(target, timeout, context.CancellationToken)
                        .ConfigureAwait(false);
                    success = response.IsSuccess;
                    result = response;
                    break;
                }
                case "dns-lookup":
                {
                    var target = RequireTarget(config);
                    var parameters = ReadParameters<DnsParameters>(config.ParametersJson);
                    var includeReverse = parameters?.IncludeReverse ?? true;
                    var response = await _scanner.DnsLookupAsync(target, includeReverse, context.CancellationToken)
                        .ConfigureAwait(false);
                    success = true;
                    result = response;
                    break;
                }
                case "ssl-inspect":
                {
                    var target = RequireTarget(config);
                    var parameters = ReadParameters<SslParameters>(config.ParametersJson);
                    var port = Math.Clamp(parameters?.Port ?? 443, 1, 65535);
                    var response = await _scanner.InspectCertificateAsync(target, port, context.CancellationToken)
                        .ConfigureAwait(false);
                    success = true;
                    result = response;
                    break;
                }
                case "public-ip":
                {
                    var response = await _scanner.GetPublicIpAsync(context.CancellationToken)
                        .ConfigureAwait(false);
                    success = true;
                    result = response;
                    break;
                }
                case "traceroute":
                {
                    var target = RequireTarget(config);
                    var parameters = ReadParameters<TracerouteParameters>(config.ParametersJson);
                    var maxHops = Math.Clamp(parameters?.MaxHops ?? 30, 1, 64);
                    var timeout = Math.Clamp(parameters?.TimeoutMs ?? 1000, 100, 5000);
                    var response = await _scanner.TraceRouteAsync(target, maxHops, timeout, context.CancellationToken)
                        .ConfigureAwait(false);
                    success = response.ReachedDestination;
                    result = response;
                    break;
                }
            }
        }
        catch (Exception ex)
        {
            errorMessage = ex.Message;
            _logger.LogWarning(ex, "Scheduled network tool {ToolType} failed", config.ToolType);
        }
        finally
        {
            sw.Stop();
        }

        config.LastRunAtUtc = DateTime.UtcNow;
        if (success)
        {
            config.LastSuccessAtUtc = config.LastRunAtUtc;
        }
        config.UpdatedAt = DateTime.UtcNow;

        await db.SaveChangesAsync(context.CancellationToken).ConfigureAwait(false);

        _ = _history.RecordAsync(
            toolType: $"scheduled-{config.ToolType}",
            target: config.Target ?? config.ToolType,
            input: new
            {
                config.Name,
                config.ToolType,
                config.Target,
                config.ParametersJson,
                config.Cron
            },
            result: result,
            success: success,
            durationMs: (int)sw.ElapsedMilliseconds,
            error: errorMessage);
    }

    private static string RequireTarget(ScheduledNetworkToolConfig config)
    {
        if (string.IsNullOrWhiteSpace(config.Target))
        {
            throw new InvalidOperationException("Scheduled network tool requires a target");
        }

        return config.Target.Trim();
    }

    private static T? ReadParameters<T>(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return default;
        }

        try
        {
            return JsonSerializer.Deserialize<T>(json);
        }
        catch
        {
            return default;
        }
    }

    private sealed record PingParameters
    {
        public int? TimeoutMs { get; init; }
    }

    private sealed record DnsParameters
    {
        public bool? IncludeReverse { get; init; }
    }

    private sealed record SslParameters
    {
        public int? Port { get; init; }
    }

    private sealed record TracerouteParameters
    {
        public int? MaxHops { get; init; }
        public int? TimeoutMs { get; init; }
    }
}
