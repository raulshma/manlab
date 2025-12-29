using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Audit;

/// <summary>
/// Background worker that persists audit events from the in-memory queue.
/// </summary>
public sealed class AuditLogWriterService : BackgroundService
{
    private readonly ILogger<AuditLogWriterService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly AuditLogQueue _queue;
    private readonly IOptionsMonitor<AuditOptions> _options;

    public AuditLogWriterService(
        ILogger<AuditLogWriterService> logger,
        IServiceScopeFactory scopeFactory,
        AuditLogQueue queue,
        IOptionsMonitor<AuditOptions> options)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _queue = queue;
        _options = options;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Small initial delay to allow migrations to complete.
        try
        {
            await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);
        }
        catch (OperationCanceledException)
        {
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await DrainOnceAsync(stoppingToken).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Audit writer loop failed");
                try
                {
                    await Task.Delay(TimeSpan.FromSeconds(2), stoppingToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
            }
        }
    }

    private async Task DrainOnceAsync(CancellationToken cancellationToken)
    {
        if (!_options.CurrentValue.Enabled)
        {
            // Still drain to avoid unbounded memory usage if configuration flips.
            while (_queue.Reader.TryRead(out _)) { }
            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            return;
        }

        var maxBatchSize = Math.Max(10, _options.CurrentValue.MaxBatchSize);
        var flushInterval = TimeSpan.FromMilliseconds(Math.Max(50, _options.CurrentValue.FlushIntervalMilliseconds));

        var batch = new List<AuditEvent>(capacity: Math.Min(maxBatchSize, 512));
        using var timer = new PeriodicTimer(flushInterval);

        // Wait for at least one item or a flush tick.
        // If nothing arrives, this loop yields quickly.
        while (batch.Count == 0 && !cancellationToken.IsCancellationRequested)
        {
            var readTask = _queue.Reader.WaitToReadAsync(cancellationToken).AsTask();
            var tickTask = timer.WaitForNextTickAsync(cancellationToken).AsTask();
            var completed = await Task.WhenAny(readTask, tickTask).ConfigureAwait(false);
            if (completed == tickTask)
            {
                return;
            }

            if (!await readTask.ConfigureAwait(false))
            {
                return;
            }

            // Try drain right away.
            break;
        }

        while (batch.Count < maxBatchSize && _queue.Reader.TryRead(out var evt))
        {
            batch.Add(evt);
        }

        if (batch.Count == 0)
        {
            return;
        }

        // Persist in one transaction for efficiency.
        const int maxAttempts = 3;
        for (var attempt = 1; attempt <= maxAttempts; attempt++)
        {
            try
            {
                await using var scope = _scopeFactory.CreateAsyncScope();
                var db = scope.ServiceProvider.GetRequiredService<DataContext>();

                db.AuditEvents.AddRange(batch);
                await db.SaveChangesAsync(cancellationToken).ConfigureAwait(false);
                return;
            }
            catch (DbUpdateException ex) when (attempt < maxAttempts)
            {
                _logger.LogWarning(ex, "Audit DB write failed (attempt {Attempt}/{MaxAttempts}); retrying", attempt, maxAttempts);
                await Task.Delay(TimeSpan.FromMilliseconds(250 * attempt), cancellationToken).ConfigureAwait(false);
            }
        }

        // If we get here, we failed all attempts; drop the batch.
        _logger.LogError("Audit DB write failed after {MaxAttempts} attempts; dropping {Count} events", maxAttempts, batch.Count);
    }
}
