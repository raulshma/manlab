using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Data.Enums;
using Microsoft.EntityFrameworkCore;
using System.Text.Json;

namespace ManLab.Server.Services.Enhancements;

/// <summary>
/// Periodically marks expired terminal sessions and enqueues terminal.close commands
/// so agents do not keep shells running past the server TTL.
/// </summary>
public sealed class TerminalSessionCleanupService : BackgroundService
{
    private static readonly TimeSpan Interval = TimeSpan.FromMinutes(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<TerminalSessionCleanupService> _logger;

    public TerminalSessionCleanupService(IServiceScopeFactory scopeFactory, ILogger<TerminalSessionCleanupService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CleanupOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Terminal session cleanup failed");
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
    }

    private async Task CleanupOnceAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var now = DateTime.UtcNow;

        // Find sessions that are still marked Open in DB but have passed ExpiresAt.
        var expired = await db.TerminalSessions
            .Where(s => s.Status == TerminalSessionStatus.Open)
            .Where(s => s.ExpiresAt <= now)
            .ToListAsync(cancellationToken)
            .ConfigureAwait(false);

        if (expired.Count == 0)
        {
            return;
        }

        foreach (var s in expired)
        {
            s.Status = TerminalSessionStatus.Expired;
            s.ClosedAt ??= now;

            // Enqueue a best-effort terminal.close so the agent kills the process promptly.
            // Safe even if the agent already closed the session.
            var payload = JsonSerializer.Serialize(new { sessionId = s.Id });
            db.CommandQueue.Add(new CommandQueueItem
            {
                Id = Guid.NewGuid(),
                NodeId = s.NodeId,
                CommandType = CommandType.TerminalClose,
                Payload = payload,
                Status = CommandStatus.Queued,
                CreatedAt = now
            });
        }

        await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);

        _logger.LogInformation("Marked {Count} terminal sessions expired and queued terminal.close commands", expired.Count);
    }
}
