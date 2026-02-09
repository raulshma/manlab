using System.Buffers;

namespace ManLab.Server.Services.Monitoring;

/// <summary>
/// Monitors memory pressure and triggers cleanup callbacks when memory is constrained.
/// Uses GC notifications and periodic checks to detect high memory usage.
/// </summary>
public sealed class MemoryPressureMonitor : BackgroundService
{
    private readonly ILogger<MemoryPressureMonitor> _logger;
    private readonly IServiceProvider _serviceProvider;

    // Thresholds for memory pressure detection
    private const double HighMemoryThresholdPercent = 85.0;
    private const double CriticalMemoryThresholdPercent = 95.0;

    // Check interval
    private static readonly TimeSpan CheckInterval = TimeSpan.FromSeconds(30);

    // Debounce: avoid triggering cleanup too frequently
    private DateTime _lastCleanupTime = DateTime.MinValue;
    private static readonly TimeSpan CleanupCooldown = TimeSpan.FromMinutes(2);

    public MemoryPressureMonitor(
        ILogger<MemoryPressureMonitor> logger,
        IServiceProvider serviceProvider)
    {
        _logger = logger;
        _serviceProvider = serviceProvider;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("MemoryPressureMonitor started");

        // Register for full GC notifications (high memory pressure indicator)
        try
        {
            GC.RegisterForFullGCNotification(10, 10);
        }
        catch (InvalidOperationException)
        {
            // Already registered or not supported on this runtime
            _logger.LogDebug("GC full notification registration skipped (already registered or not supported)");
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                // Check for GC notification (non-blocking)
                var gcStatus = GC.WaitForFullGCApproach(0);
                if (gcStatus == GCNotificationStatus.Succeeded)
                {
                    _logger.LogDebug("Full GC approaching, checking memory pressure");
                    await CheckAndCleanupAsync(stoppingToken).ConfigureAwait(false);
                }

                // Periodic memory check
                var memoryInfo = GC.GetGCMemoryInfo();
                var heapSizeBytes = memoryInfo.HeapSizeBytes;
                var totalAvailableBytes = memoryInfo.TotalAvailableMemoryBytes;

                if (totalAvailableBytes > 0)
                {
                    var usedPercent = (double)heapSizeBytes / totalAvailableBytes * 100;

                    if (usedPercent >= CriticalMemoryThresholdPercent)
                    {
                        _logger.LogWarning(
                            "Critical memory pressure detected: {UsedPercent:F1}% ({HeapMB:F0} MB / {TotalMB:F0} MB available)",
                            usedPercent,
                            heapSizeBytes / (1024.0 * 1024.0),
                            totalAvailableBytes / (1024.0 * 1024.0));

                        await TriggerAggressiveCleanupAsync(stoppingToken).ConfigureAwait(false);
                    }
                    else if (usedPercent >= HighMemoryThresholdPercent)
                    {
                        _logger.LogInformation(
                            "High memory pressure detected: {UsedPercent:F1}% ({HeapMB:F0} MB / {TotalMB:F0} MB available)",
                            usedPercent,
                            heapSizeBytes / (1024.0 * 1024.0),
                            totalAvailableBytes / (1024.0 * 1024.0));

                        await CheckAndCleanupAsync(stoppingToken).ConfigureAwait(false);
                    }
                }

                await Task.Delay(CheckInterval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Shutting down
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in memory pressure monitoring loop");
                await Task.Delay(TimeSpan.FromSeconds(60), stoppingToken).ConfigureAwait(false);
            }
        }

        // Unregister GC notification
        try
        {
            GC.CancelFullGCNotification();
        }
        catch
        {
            // Ignore errors during shutdown
        }

        _logger.LogInformation("MemoryPressureMonitor stopped");
    }

    private async Task CheckAndCleanupAsync(CancellationToken cancellationToken)
    {
        // Debounce cleanup calls
        if (DateTime.UtcNow - _lastCleanupTime < CleanupCooldown)
        {
            return;
        }

        _lastCleanupTime = DateTime.UtcNow;

        _logger.LogInformation("Running memory pressure cleanup...");

        using var scope = _serviceProvider.CreateScope();

        // Cleanup download sessions
        try
        {
            var downloadSessions = scope.ServiceProvider.GetService<Enhancements.DownloadSessionService>();
            if (downloadSessions is not null)
            {
                var cleaned = downloadSessions.CleanupExpiredSessions();
                if (cleaned > 0)
                {
                    _logger.LogInformation("Cleaned up {Count} expired download sessions", cleaned);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to cleanup download sessions");
        }

        // Cleanup streaming downloads
        try
        {
            var streamingDownloads = scope.ServiceProvider.GetService<Enhancements.StreamingDownloadService>();
            if (streamingDownloads is not null)
            {
                var cleaned = streamingDownloads.CleanupExpiredSessions();
                if (cleaned > 0)
                {
                    _logger.LogInformation("Cleaned up {Count} expired streaming downloads", cleaned);
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to cleanup streaming downloads");
        }

        // Clear packet capture buffer if under pressure
        try
        {
            var packetCapture = scope.ServiceProvider.GetService<Network.IPacketCaptureService>();
            packetCapture?.Clear();
            _logger.LogDebug("Cleared packet capture buffer");
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to clear packet capture buffer");
        }

        // Force a Gen 2 collection to compact the heap
        await Task.Run(() =>
        {
            GC.Collect(2, GCCollectionMode.Optimized, blocking: false, compacting: false);
        }, cancellationToken).ConfigureAwait(false);

        _logger.LogInformation("Memory pressure cleanup completed");
    }

    private async Task TriggerAggressiveCleanupAsync(CancellationToken cancellationToken)
    {
        // Reset cooldown for critical pressure
        _lastCleanupTime = DateTime.MinValue;

        await CheckAndCleanupAsync(cancellationToken).ConfigureAwait(false);

        // More aggressive GC for critical pressure
        await Task.Run(() =>
        {
            GC.Collect(2, GCCollectionMode.Aggressive, blocking: true, compacting: true);
            GC.WaitForPendingFinalizers();
            GC.Collect(2, GCCollectionMode.Aggressive, blocking: true, compacting: true);
        }, cancellationToken).ConfigureAwait(false);

        // Return buffers to the shared pool
        ArrayPool<byte>.Shared.Return(ArrayPool<byte>.Shared.Rent(1), clearArray: false);

        _logger.LogWarning("Aggressive memory cleanup completed");
    }
}
