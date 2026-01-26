using System.Diagnostics;
using ManLab.Server.Hubs;
using ManLab.Shared.Dtos;
using Microsoft.AspNetCore.SignalR;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// Collects server process resource usage and streams it to dashboard clients.
/// </summary>
public sealed class ServerResourceUsageService : BackgroundService
{
    private static readonly TimeSpan SampleInterval = TimeSpan.FromSeconds(2);

    private readonly IHubContext<AgentHub> _hubContext;
    private readonly DashboardConnectionTracker _connectionTracker;
    private readonly ILogger<ServerResourceUsageService> _logger;

    private bool _cpuInitialized;
    private TimeSpan _prevCpuTime;
    private DateTime _prevSampleAtUtc;

    public ServerResourceUsageService(
        IHubContext<AgentHub> hubContext,
        DashboardConnectionTracker connectionTracker,
        ILogger<ServerResourceUsageService> logger)
    {
        _hubContext = hubContext;
        _connectionTracker = connectionTracker;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(SampleInterval);

        while (!stoppingToken.IsCancellationRequested && await timer.WaitForNextTickAsync(stoppingToken))
        {
            if (!_connectionTracker.HasDashboards)
            {
                ResetCpuTracking();
                continue;
            }

            try
            {
                var snapshot = Collect();
                await _hubContext.Clients
                    .Group(AgentHub.DashboardGroupName)
                    .SendAsync("ServerResourceUsage", snapshot, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to collect server resource usage");
            }
        }
    }

    private void ResetCpuTracking()
    {
        _cpuInitialized = false;
        _prevCpuTime = default;
        _prevSampleAtUtc = default;
    }

    private ServerResourceUsageDto Collect()
    {
        using var process = Process.GetCurrentProcess();
        var now = DateTime.UtcNow;

        float? cpuPercent = null;
        var cpuTime = process.TotalProcessorTime;

        if (_cpuInitialized)
        {
            var elapsed = now - _prevSampleAtUtc;
            if (elapsed.TotalMilliseconds > 0)
            {
                var cpuMs = (cpuTime - _prevCpuTime).TotalMilliseconds;
                var percent = cpuMs / (elapsed.TotalMilliseconds * Environment.ProcessorCount) * 100.0;
                cpuPercent = (float)Math.Clamp(percent, 0, 100);
            }
        }

        _prevCpuTime = cpuTime;
        _prevSampleAtUtc = now;
        _cpuInitialized = true;

        return new ServerResourceUsageDto
        {
            TimestampUtc = now,
            CpuPercent = cpuPercent,
            MemoryBytes = process.WorkingSet64,
            GcHeapBytes = GC.GetTotalMemory(forceFullCollection: false),
            ThreadCount = process.Threads.Count
        };
    }
}
