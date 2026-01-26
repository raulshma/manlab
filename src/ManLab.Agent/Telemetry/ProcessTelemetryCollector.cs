using System.Diagnostics;
using ManLab.Shared.Dtos;
using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Telemetry;

/// <summary>
/// Collects a lightweight snapshot of top processes by CPU and memory.
/// </summary>
public sealed class ProcessTelemetryCollector
{
    private readonly ILogger _logger;
    private readonly Dictionary<int, (TimeSpan CpuTime, DateTime SampleAt)> _cpuSamples = new();

    public ProcessTelemetryCollector(ILogger logger)
    {
        _logger = logger;
    }

    public List<ProcessTelemetry> Collect(int maxItems = 10)
    {
        var now = DateTime.UtcNow;
        var list = new List<ProcessTelemetry>();
        var activePids = new HashSet<int>();

        Process[] processes;
        try
        {
            processes = Process.GetProcesses();
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to enumerate processes for telemetry");
            return list;
        }

        list.Capacity = Math.Max(list.Capacity, processes.Length);

        foreach (var process in processes)
        {
            try
            {
                var pid = process.Id;
            activePids.Add(pid);
                var cpuPercent = TryComputeCpuPercent(pid, process, now);
                var memoryBytes = process.WorkingSet64;

                list.Add(new ProcessTelemetry
                {
                    ProcessId = pid,
                    ProcessName = process.ProcessName,
                    CpuPercent = cpuPercent,
                    MemoryBytes = memoryBytes
                });
            }
            catch
            {
                // Some processes may exit or deny access; skip quietly.
            }
            finally
            {
                process.Dispose();
            }
        }

        if (activePids.Count > 0 && _cpuSamples.Count > activePids.Count)
        {
            foreach (var pid in _cpuSamples.Keys.ToArray())
            {
                if (!activePids.Contains(pid))
                {
                    _cpuSamples.Remove(pid);
                }
            }
        }

        var topByCpu = list
            .Where(p => p.CpuPercent.HasValue)
            .OrderByDescending(p => p.CpuPercent)
            .Take(maxItems)
            .Select(p => p.ProcessId)
            .ToHashSet();

        var topByMem = list
            .OrderByDescending(p => p.MemoryBytes ?? 0)
            .Take(maxItems)
            .Select(p => p.ProcessId)
            .ToHashSet();

        var selectedIds = topByCpu.Union(topByMem).ToHashSet();

        return list
            .Where(p => selectedIds.Contains(p.ProcessId))
            .OrderByDescending(p => p.CpuPercent ?? -1)
            .ThenByDescending(p => p.MemoryBytes ?? 0)
            .Take(Math.Max(1, maxItems))
            .ToList();
    }

    private float? TryComputeCpuPercent(int pid, Process process, DateTime now)
    {
        try
        {
            var cpuTime = process.TotalProcessorTime;
            if (!_cpuSamples.TryGetValue(pid, out var prev))
            {
                _cpuSamples[pid] = (cpuTime, now);
                return null;
            }

            var elapsed = now - prev.SampleAt;
            if (elapsed.TotalSeconds < 0.5)
            {
                return null;
            }

            var delta = cpuTime - prev.CpuTime;
            _cpuSamples[pid] = (cpuTime, now);

            var percent = (float)(delta.TotalMilliseconds / elapsed.TotalMilliseconds / Environment.ProcessorCount * 100);
            return Math.Clamp(percent, 0f, 100f);
        }
        catch
        {
            return null;
        }
    }
}
