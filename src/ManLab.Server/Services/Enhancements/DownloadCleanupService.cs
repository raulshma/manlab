using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using System;
using System.Threading;
using System.Threading.Tasks;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// Periodically cleans up expired download sessions and streaming downloads.
/// </summary>
public sealed class DownloadCleanupService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(5);

    private readonly DownloadSessionService _downloadSessions;
    private readonly StreamingDownloadService _streamingDownloads;
    private readonly ILogger<DownloadCleanupService> _logger;

    public DownloadCleanupService(
        DownloadSessionService downloadSessions,
        StreamingDownloadService streamingDownloads,
        ILogger<DownloadCleanupService> logger)
    {
        _downloadSessions = downloadSessions;
        _streamingDownloads = streamingDownloads;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _logger.LogInformation("DownloadCleanupService started");

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                CleanupOnce();
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Download cleanup failed");
            }

            try
            {
                await Task.Delay(Interval, stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Shutting down
            }
        }

        _logger.LogInformation("DownloadCleanupService stopped");
    }

    private void CleanupOnce()
    {
        var cleanedSessions = _downloadSessions.CleanupExpiredSessions();
        var cleanedStreams = _streamingDownloads.CleanupExpiredSessions();

        if (cleanedSessions > 0 || cleanedStreams > 0)
        {
            _logger.LogInformation(
                "Cleanup completed: {CleanedSessions} sessions, {CleanedStreams} streaming downloads removed",
                cleanedSessions, cleanedStreams);
        }
    }
}
