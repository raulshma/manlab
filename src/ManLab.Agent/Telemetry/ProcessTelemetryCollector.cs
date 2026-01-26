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

        list.Capacity = processes.Length;

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
            List<int>? toRemove = null;
            foreach (var pid in _cpuSamples.Keys)
            {
                if (!activePids.Contains(pid))
                {
                    toRemove ??= new List<int>();
                    toRemove.Add(pid);
                }
            }

            if (toRemove is not null)
            {
                foreach (var pid in toRemove)
                {
                    _cpuSamples.Remove(pid);
                }
            }
        }

        if (list.Count == 0)
        {
            return list;
        }

        var max = Math.Max(1, maxItems);
        var selectedIds = new HashSet<int>();

        var byCpu = list.ToArray();
        Array.Sort(byCpu, static (a, b) => (b.CpuPercent ?? -1).CompareTo(a.CpuPercent ?? -1));
        var cpuCount = 0;
        for (var i = 0; i < byCpu.Length && cpuCount < max; i++)
        {
            if (!byCpu[i].CpuPercent.HasValue)
            {
                continue;
            }

            if (selectedIds.Add(byCpu[i].ProcessId))
            {
                cpuCount++;
            }
        }

        Array.Sort(byCpu, static (a, b) => (b.MemoryBytes ?? 0).CompareTo(a.MemoryBytes ?? 0));
        for (var i = 0; i < byCpu.Length && selectedIds.Count < max * 2; i++)
        {
            selectedIds.Add(byCpu[i].ProcessId);
        }

        var result = new List<ProcessTelemetry>(Math.Min(list.Count, max * 2));
        foreach (var item in list)
        {
            if (selectedIds.Contains(item.ProcessId))
            {
                result.Add(item);
            }
        }

        result.Sort(static (a, b) =>
        {
            var cpuCompare = (b.CpuPercent ?? -1).CompareTo(a.CpuPercent ?? -1);
            if (cpuCompare != 0)
            {
                return cpuCompare;
            }

            return (b.MemoryBytes ?? 0).CompareTo(a.MemoryBytes ?? 0);
        });

        if (result.Count > max)
        {
            result.RemoveRange(max, result.Count - max);
        }

        return result;
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
