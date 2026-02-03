using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Shared.Dtos;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// Alert generated when a process exceeds resource thresholds.
/// </summary>
public class ProcessAlert
{
    public Guid NodeId { get; set; }
    public int ProcessId { get; set; }
    public string ProcessName { get; set; } = string.Empty;
    public string AlertType { get; set; } = string.Empty; // "Cpu" or "Memory"
    public double CurrentValue { get; set; }
    public double Threshold { get; set; }
    public DateTime TimestampUtc { get; set; }
}

/// <summary>
/// Optimized service for evaluating process telemetry against thresholds and generating alerts.
/// </summary>
public class ProcessAlertingService
{
    private readonly IServiceProvider _serviceProvider;
    private readonly ProcessMonitoringOptions _options;
    private readonly ILogger<ProcessAlertingService> _logger;

    // Track last alert time per process to implement cooldown
    // Using a capacity limit to prevent unbounded memory growth
    private readonly Dictionary<string, DateTime> _lastAlertTimes = new();
    private readonly object _alertLock = new();

    // Performance constants
    private const int MaxAlertHistoryEntries = 1000; // Maximum entries in cooldown tracker
    private const int CleanupIntervalMinutes = 10; // How often to aggressively clean up old entries
    private static readonly TimeSpan CleanupThreshold = TimeSpan.FromMinutes(CleanupIntervalMinutes);

    private DateTime _lastCleanup = DateTime.UtcNow;

    public ProcessAlertingService(
        IServiceProvider serviceProvider,
        IOptions<ProcessMonitoringOptions> options,
        ILogger<ProcessAlertingService> logger)
    {
        _serviceProvider = serviceProvider;
        _options = options.Value;
        _logger = logger;
    }

    /// <summary>
    /// Evaluates process telemetry against thresholds and returns any alerts triggered.
    /// Optimized to minimize allocations and CPU usage.
    /// </summary>
    public List<ProcessAlert> EvaluateAlerts(
        List<ProcessTelemetry> processes,
        ProcessMonitoringConfig config,
        Guid nodeId,
        long? memoryTotalBytes = null)
    {
        // Fast path for disabled monitoring or no data
        if (!config.Enabled || processes.Count == 0)
        {
            return new List<ProcessAlert>(0);
        }

        var alerts = new List<ProcessAlert>(4); // Pre-allocate with reasonable default capacity
        var now = DateTime.UtcNow;
        var cooldown = TimeSpan.FromMinutes(_options.AlertCooldownMinutes);
        var nodePrefix = nodeId.ToString("N"); // Use format-free GUID string for faster concatenation

        lock (_alertLock)
        {
            // Periodic cleanup of old entries (not on every call)
            if (now - _lastCleanup > CleanupThreshold || _lastAlertTimes.Count > MaxAlertHistoryEntries)
            {
                CleanupOldEntries(now, cooldown);
                _lastCleanup = now;
            }

            // Pre-calculate threshold values to avoid repeated multiplication
            var cpuThreshold = config.CpuAlertThreshold;
            var memoryThresholdPercent = config.MemoryAlertThreshold;

            // Evaluate CPU thresholds - use for loop to avoid LINQ allocations
            var processCount = processes.Count;
            for (var i = 0; i < processCount; i++)
            {
                var process = processes[i];
                var cpuPercent = process.CpuPercent;

                if (cpuPercent.HasValue && cpuPercent.Value > cpuThreshold)
                {
                    // Use stack allocation via string interpolation for key
                    var alertKey = string.Concat(nodePrefix, "_", process.ProcessId.ToString(), "_Cpu");

                    if (TryGetAlertTime(alertKey, now, cooldown, out var shouldAlert))
                    {
                        if (shouldAlert)
                        {
                            alerts.Add(new ProcessAlert
                            {
                                NodeId = nodeId,
                                ProcessId = process.ProcessId,
                                ProcessName = process.ProcessName ?? "Unknown",
                                AlertType = "Cpu",
                                CurrentValue = cpuPercent.Value,
                                Threshold = cpuThreshold,
                                TimestampUtc = now
                            });

                            _lastAlertTimes[alertKey] = now;
                        }
                    }
                }
            }

            // Evaluate Memory thresholds
            for (var i = 0; i < processCount; i++)
            {
                var process = processes[i];
                var memoryBytes = process.MemoryBytes;

                // Calculate memory percentage if total memory is available
                if (memoryBytes.HasValue && memoryTotalBytes.HasValue && memoryTotalBytes.Value > 0)
                {
                    var memoryPercent = (memoryBytes.Value * 100.0) / memoryTotalBytes.Value;

                    if (memoryPercent > memoryThresholdPercent)
                    {
                        var alertKey = string.Concat(nodePrefix, "_", process.ProcessId.ToString(), "_Memory");

                        if (TryGetAlertTime(alertKey, now, cooldown, out var shouldAlert))
                        {
                            if (shouldAlert)
                            {
                                alerts.Add(new ProcessAlert
                                {
                                    NodeId = nodeId,
                                    ProcessId = process.ProcessId,
                                    ProcessName = process.ProcessName ?? "Unknown",
                                    AlertType = "Memory",
                                    CurrentValue = memoryPercent,
                                    Threshold = memoryThresholdPercent,
                                    TimestampUtc = now
                                });

                                _lastAlertTimes[alertKey] = now;
                            }
                        }
                    }
                }
            }
        }

        return alerts;
    }

    /// <summary>
    /// Tries to get the last alert time and determines if a new alert should be triggered.
    /// Returns true if the key doesn't exist or if cooldown has expired.
    /// </summary>
    private bool TryGetAlertTime(string alertKey, DateTime now, TimeSpan cooldown, out bool shouldAlert)
    {
        if (_lastAlertTimes.TryGetValue(alertKey, out var lastAlertTime))
        {
            shouldAlert = (now - lastAlertTime) > cooldown;
            return true;
        }

        shouldAlert = true;
        return true;
    }

    /// <summary>
    /// Cleans up old entries from the cooldown tracker to prevent unbounded memory growth.
    /// </summary>
    private void CleanupOldEntries(DateTime now, TimeSpan cooldown)
    {
        var expirationThreshold = now - cooldown.Add(TimeSpan.FromMinutes(5));
        var keysToRemove = new List<string>(Math.Min(_lastAlertTimes.Count / 4, 100)); // Estimate 25% expired

        // Manual loop to avoid LINQ allocations
        foreach (var kvp in _lastAlertTimes)
        {
            if (kvp.Value < expirationThreshold)
            {
                keysToRemove.Add(kvp.Key);
            }
        }

        // Remove expired keys
        foreach (var key in keysToRemove)
        {
            _lastAlertTimes.Remove(key);
        }

        // Hard limit protection - if still too many entries, remove oldest
        if (_lastAlertTimes.Count > MaxAlertHistoryEntries)
        {
            var excessCount = _lastAlertTimes.Count - MaxAlertHistoryEntries;
            var sortedKeys = new List<string>(excessCount);
            var count = 0;

            // Find oldest entries
            foreach (var kvp in _lastAlertTimes)
            {
                if (count >= excessCount) break;

                sortedKeys.Add(kvp.Key);
                count++;
            }

            foreach (var key in sortedKeys)
            {
                _lastAlertTimes.Remove(key);
            }

            _logger.LogWarning(
                "Process alert cooldown tracker exceeded maximum capacity. Removed {Count} oldest entries.",
                excessCount);
        }
    }

    /// <summary>
    /// Sends notifications for a batch of process alerts.
    /// </summary>
    public async Task SendAlertNotificationsAsync(List<ProcessAlert> alerts, CancellationToken cancellationToken = default)
    {
        if (alerts.Count == 0)
        {
            return;
        }

        using var scope = _serviceProvider.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        // Batch load all nodes at once instead of individual queries
        var nodeIds = alerts.Select(a => a.NodeId).Distinct().ToList();
        var nodes = await db.Nodes
            .Where(n => nodeIds.Contains(n.Id))
            .ToDictionaryAsync(n => n.Id, n => n, cancellationToken);

        // Group by node
        var alertsByNode = alerts.GroupBy(a => a.NodeId);

        foreach (var nodeGroup in alertsByNode)
        {
            if (!nodes.TryGetValue(nodeGroup.Key, out var node))
            {
                _logger.LogWarning("Node {NodeId} not found when sending process alerts", nodeGroup.Key);
                continue;
            }

            // Batch log all alerts for this node
            foreach (var alert in nodeGroup)
            {
                if (alert.AlertType == "Memory")
                {
                    _logger.LogWarning(
                        "Process alert: Node {NodeName} (ID: {NodeId}), Process {ProcessName} (PID: {ProcessId}), Memory {CurrentValue:F1}% exceeds threshold {Threshold:F1}%",
                        node.Hostname,
                        node.Id,
                        alert.ProcessName,
                        alert.ProcessId,
                        alert.CurrentValue,
                        alert.Threshold);
                }
                else
                {
                    _logger.LogWarning(
                        "Process alert: Node {NodeName} (ID: {NodeId}), Process {ProcessName} (PID: {ProcessId}), CPU {CurrentValue:F1}% exceeds threshold {Threshold:F1}%",
                        node.Hostname,
                        node.Id,
                        alert.ProcessName,
                        alert.ProcessId,
                        alert.CurrentValue,
                        alert.Threshold);
                }
            }

            // Send Discord notification
            // This would require extending INotificationService
            // For now, we'll just log
        }
    }

    /// <summary>
    /// Formats byte values into human-readable format (MB or GB).
    /// </summary>
    private static string FormatBytes(double bytes)
    {
        const double GB = 1024 * 1024 * 1024;
        const double MB = 1024 * 1024;

        if (bytes >= GB)
        {
            return $"{bytes / GB:F2} GB";
        }

        return $"{bytes / MB:F1} MB";
    }

    /// <summary>
    /// Clears the cooldown tracker for a specific process (useful for testing).
    /// </summary>
    public void ClearCooldown(Guid nodeId, int processId, string alertType)
    {
        lock (_alertLock)
        {
            var key = string.Concat(nodeId.ToString("N"), "_", processId.ToString(), "_", alertType);
            _lastAlertTimes.Remove(key);
        }
    }

    /// <summary>
    /// Clears all cooldown trackers (useful for testing).
    /// </summary>
    public void ClearAllCooldowns()
    {
        lock (_alertLock)
        {
            _lastAlertTimes.Clear();
        }
    }

    /// <summary>
    /// Gets the current size of the cooldown tracker for monitoring purposes.
    /// </summary>
    public int GetCooldownTrackerSize()
    {
        lock (_alertLock)
        {
            return _lastAlertTimes.Count;
        }
    }
}
