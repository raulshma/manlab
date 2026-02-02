using System.Threading.Channels;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Options;
using NATS.Client.Core;

namespace ManLab.Server.Services.Audit;

/// <summary>
/// Background worker that persists audit events from NATS.
/// </summary>
public sealed class AuditLogWriterService : BackgroundService
{
    private readonly ILogger<AuditLogWriterService> _logger;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly INatsConnection _nats;
    private readonly IOptionsMonitor<AuditOptions> _options;
    private readonly Channel<AuditEvent> _localQueue;

    public AuditLogWriterService(
        ILogger<AuditLogWriterService> logger,
        IServiceScopeFactory scopeFactory,
        INatsConnection nats,
        IOptionsMonitor<AuditOptions> options)
    {
        _logger = logger;
        _scopeFactory = scopeFactory;
        _nats = nats;
        _options = options;

        // Local buffer to decouple NATS subscription from DB writes
        _localQueue = Channel.CreateBounded<AuditEvent>(new BoundedChannelOptions(1000)
        {
            SingleReader = true,
            SingleWriter = true, // NATS subscription loop is the single writer
            FullMode = BoundedChannelFullMode.DropWrite
        });
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        // Start the NATS consumer loop
        var consumeTask = ConsumeNatsAsync(stoppingToken);

        // Start the DB writer loop
        var writeTask = RunWriterLoopAsync(stoppingToken);

        try
        {
            await Task.WhenAll(consumeTask, writeTask);
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Audit writer service failed");
        }
    }

    private async Task ConsumeNatsAsync(CancellationToken ct)
    {
        try
        {
            await foreach (var msg in _nats.SubscribeAsync<AuditEvent>(AuditLogQueue.Subject, queueGroup: "manlab.server.audit", cancellationToken: ct))
            {
                if (msg.Data is { } evt)
                {
                    if (!_localQueue.Writer.TryWrite(evt))
                    {
                        // Limit local buffering if DB is too slow
                    }
                }
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to consume audit events from NATS");
        }
    }

    private async Task RunWriterLoopAsync(CancellationToken stoppingToken)
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
            while (_localQueue.Reader.TryRead(out _)) { }
            await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken);
            return;
        }

        var maxBatchSize = Math.Max(10, _options.CurrentValue.MaxBatchSize);
        var flushInterval = TimeSpan.FromMilliseconds(Math.Max(50, _options.CurrentValue.FlushIntervalMilliseconds));

        var batch = new List<AuditEvent>(capacity: Math.Min(maxBatchSize, 512));
        using var timer = new PeriodicTimer(flushInterval);

        // Wait for at least one item or a flush tick.
        while (batch.Count == 0 && !cancellationToken.IsCancellationRequested)
        {
            var readTask = _localQueue.Reader.WaitToReadAsync(cancellationToken).AsTask();
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

        while (batch.Count < maxBatchSize && _localQueue.Reader.TryRead(out var evt))
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

