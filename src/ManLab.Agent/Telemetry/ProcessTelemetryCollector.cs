using System.Diagnostics;
using System.Text.RegularExpressions;
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

    /// <summary>
    /// Collects process telemetry with optional filtering and configurable limits.
    /// </summary>
    /// <param name="maxCpuItems">Maximum number of top CPU processes to return (default: 10).</param>
    /// <param name="maxMemoryItems">Maximum number of top memory processes to return (default: 10).</param>
    /// <param name="excludePatterns">Optional array of wildcard patterns to exclude (e.g., "system*", "idle").</param>
    /// <returns>List of process telemetry entries.</returns>
    public List<ProcessTelemetry> Collect(int maxCpuItems = 10, int maxMemoryItems = 10, string[]? excludePatterns = null)
    {
        var now = DateTime.UtcNow;
        var list = new List<ProcessTelemetry>();
        var activePids = new HashSet<int>();

        // Precompile exclusion patterns if provided
        Regex[]? exclusionRegexes = null;
        if (excludePatterns != null && excludePatterns.Length > 0)
        {
            try
            {
                exclusionRegexes = excludePatterns
                    .Where(p => !string.IsNullOrWhiteSpace(p))
                    .Select(pattern => new Regex(
                        "^" + Regex.Escape(pattern).Replace("\\*", ".*").Replace("\\?", ".") + "$",
                        RegexOptions.IgnoreCase | RegexOptions.Compiled))
                    .ToArray();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to compile exclusion patterns, proceeding without filtering");
                exclusionRegexes = null;
            }
        }

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
                var processName = process.ProcessName;

                // Apply exclusion patterns
                if (exclusionRegexes != null && exclusionRegexes.Length > 0)
                {
                    var isExcluded = false;
                    foreach (var regex in exclusionRegexes)
                    {
                        if (regex.IsMatch(processName))
                        {
                            isExcluded = true;
                            break;
                        }
                    }

                    if (isExcluded)
                    {
                        continue;
                    }
                }

                activePids.Add(pid);
                var cpuPercent = TryComputeCpuPercent(pid, process, now);
                var memoryBytes = process.WorkingSet64;

                list.Add(new ProcessTelemetry
                {
                    ProcessId = pid,
                    ProcessName = processName,
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

        var maxCpu = Math.Max(1, maxCpuItems);
        var maxMemory = Math.Max(1, maxMemoryItems);
        var selectedIds = new HashSet<int>();

        var byCpu = list.ToArray();
        Array.Sort(byCpu, static (a, b) => (b.CpuPercent ?? -1).CompareTo(a.CpuPercent ?? -1));
        var cpuCount = 0;
        for (var i = 0; i < byCpu.Length && cpuCount < maxCpu; i++)
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
        for (var i = 0; i < byCpu.Length && selectedIds.Count < maxCpu + maxMemory; i++)
        {
            selectedIds.Add(byCpu[i].ProcessId);
        }

        var result = new List<ProcessTelemetry>(Math.Min(list.Count, maxCpu + maxMemory));
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

        if (result.Count > maxCpu + maxMemory)
        {
            result.RemoveRange(maxCpu + maxMemory, result.Count - (maxCpu + maxMemory));
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
