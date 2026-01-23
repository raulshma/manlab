using System.Text.Json;
using System.Threading.Channels;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities;
using Microsoft.EntityFrameworkCore;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Implementation of network tool history service.
/// Uses a Channel for non-blocking async writes to avoid slowing down tool execution.
/// </summary>
public sealed class NetworkToolHistoryService : INetworkToolHistoryService, IHostedService
{
    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = false,
        DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull
    };

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<NetworkToolHistoryService> _logger;
    private readonly Channel<NetworkToolHistoryEntry> _channel;
    private Task? _writerTask;
    private CancellationTokenSource? _cts;

    public NetworkToolHistoryService(
        IServiceScopeFactory scopeFactory,
        ILogger<NetworkToolHistoryService> logger)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _channel = Channel.CreateBounded<NetworkToolHistoryEntry>(new BoundedChannelOptions(1000)
        {
            FullMode = BoundedChannelFullMode.DropOldest,
            SingleReader = true,
            SingleWriter = false
        });
    }

    public Task<Guid> RecordAsync(
        string toolType,
        string target,
        object? input,
        object? result,
        bool success,
        int durationMs,
        string? error = null,
        string? connectionId = null)
    {
        var entry = new NetworkToolHistoryEntry
        {
            Id = Guid.NewGuid(),
            TimestampUtc = DateTime.UtcNow,
            ToolType = TruncateString(toolType, 32) ?? "unknown",
            Target = TruncateString(target, 256),
            InputJson = SerializeToJson(input),
            ResultJson = SerializeToJson(result),
            Success = success,
            DurationMs = durationMs,
            ErrorMessage = TruncateString(error, 2048),
            ConnectionId = TruncateString(connectionId, 128)
        };

        // Non-blocking write to channel
        if (!_channel.Writer.TryWrite(entry))
        {
            _logger.LogWarning("Network tool history channel full, dropping entry for {ToolType}", toolType);
        }

        return Task.FromResult(entry.Id);
    }

    public async Task<List<NetworkToolHistoryEntry>> GetRecentAsync(int count = 50, string? toolType = null)
    {
        count = Math.Clamp(count, 1, 500);

        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var query = db.NetworkToolHistory.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(toolType))
        {
            query = query.Where(e => e.ToolType == toolType);
        }

        return await query
            .OrderByDescending(e => e.TimestampUtc)
            .Take(count)
            .ToListAsync();
    }

    public async Task<NetworkToolHistoryEntry?> GetByIdAsync(Guid id)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        return await db.NetworkToolHistory
            .AsNoTracking()
            .FirstOrDefaultAsync(e => e.Id == id);
    }

    public async Task<bool> DeleteAsync(Guid id)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var rows = await db.NetworkToolHistory
            .Where(e => e.Id == id)
            .ExecuteDeleteAsync();

        return rows > 0;
    }

    public async Task<int> DeleteOlderThanAsync(DateTime cutoffUtc)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        return await db.NetworkToolHistory
            .Where(e => e.TimestampUtc < cutoffUtc)
            .ExecuteDeleteAsync();
    }

    public async Task<bool> UpdateAsync(
        Guid id,
        object? input,
        object? result,
        bool success,
        int durationMs,
        string? error = null,
        string? target = null)
    {
        using var scope = _scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var entry = await db.NetworkToolHistory.FirstOrDefaultAsync(e => e.Id == id);
        if (entry is null)
        {
            return false;
        }

        entry.TimestampUtc = DateTime.UtcNow;
        entry.InputJson = SerializeToJson(input);
        entry.ResultJson = SerializeToJson(result);
        entry.Success = success;
        entry.DurationMs = durationMs;
        entry.ErrorMessage = TruncateString(error, 2048);
        if (!string.IsNullOrWhiteSpace(target))
        {
            entry.Target = TruncateString(target, 256);
        }

        await db.SaveChangesAsync();
        return true;
    }

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _cts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        _writerTask = Task.Run(() => WriteLoopAsync(_cts.Token), _cts.Token);
        _logger.LogInformation("Network tool history writer started");
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        _channel.Writer.Complete();
        _cts?.Cancel();

        if (_writerTask is not null)
        {
            try
            {
                await _writerTask.WaitAsync(TimeSpan.FromSeconds(5), cancellationToken);
            }
            catch (TimeoutException)
            {
                _logger.LogWarning("Network tool history writer did not stop in time");
            }
            catch (OperationCanceledException)
            {
                // Expected
            }
        }

        _logger.LogInformation("Network tool history writer stopped");
    }

    private async Task WriteLoopAsync(CancellationToken ct)
    {
        var batch = new List<NetworkToolHistoryEntry>(50);

        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Wait for at least one item
                while (await _channel.Reader.WaitToReadAsync(ct))
                {
                    batch.Clear();

                    // Drain available items up to batch size
                    while (batch.Count < 50 && _channel.Reader.TryRead(out var entry))
                    {
                        batch.Add(entry);
                    }

                    if (batch.Count > 0)
                    {
                        await FlushBatchAsync(batch);
                    }
                }
            }
            catch (OperationCanceledException) when (ct.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Error in network tool history write loop");
                await Task.Delay(1000, ct);
            }
        }

        // Drain remaining items on shutdown
        batch.Clear();
        while (_channel.Reader.TryRead(out var entry))
        {
            batch.Add(entry);
        }

        if (batch.Count > 0)
        {
            await FlushBatchAsync(batch);
        }
    }

    private async Task FlushBatchAsync(List<NetworkToolHistoryEntry> batch)
    {
        try
        {
            using var scope = _scopeFactory.CreateScope();
            var db = scope.ServiceProvider.GetRequiredService<DataContext>();

            db.NetworkToolHistory.AddRange(batch);
            await db.SaveChangesAsync();

            _logger.LogDebug("Flushed {Count} network tool history entries", batch.Count);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to flush network tool history batch of {Count} entries", batch.Count);
        }
    }

    private static string? SerializeToJson(object? obj)
    {
        if (obj is null) return null;

        try
        {
            var json = JsonSerializer.Serialize(obj, JsonOptions);
            // Truncate large payloads
            if (json.Length > 32768)
            {
                return "{\"_truncated\":true}";
            }
            return json;
        }
        catch
        {
            return "{\"_error\":\"serialization_failed\"}";
        }
    }

    private static string? TruncateString(string? s, int maxLen)
    {
        if (string.IsNullOrEmpty(s)) return null;
        return s.Length <= maxLen ? s : s[..maxLen];
    }
}
