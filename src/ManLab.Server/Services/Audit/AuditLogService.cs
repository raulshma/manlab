using System.Diagnostics;
using System.Diagnostics.Metrics;
using System.Text;
using System.Text.Json;
using ManLab.Server.Data.Entities;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Audit;

/// <summary>
/// Fast-path enqueue service for audit events.
/// </summary>
public sealed class AuditLogService : IAuditLog
{
    private static readonly Meter Meter = new("ManLab.Server.Audit", "1.0.0");
    private static readonly Counter<long> Enqueued = Meter.CreateCounter<long>("audit.events.enqueued");
    private static readonly Counter<long> Dropped = Meter.CreateCounter<long>("audit.events.dropped");

    private readonly ILogger<AuditLogService> _logger;
    private readonly AuditLogQueue _queue;
    private readonly IOptionsMonitor<AuditOptions> _options;

    public AuditLogService(
        ILogger<AuditLogService> logger,
        AuditLogQueue queue,
        IOptionsMonitor<AuditOptions> options)
    {
        _logger = logger;
        _queue = queue;
        _options = options;
    }

    public bool TryEnqueue(AuditEvent evt)
    {
        try
        {
            if (!_options.CurrentValue.Enabled)
            {
                Dropped.Add(1);
                return false;
            }

            Normalize(evt);

            // Fire-and-forget dispatch to NATS.
            _ = Task.Run(async () =>
            {
                try
                {
                    await _queue.TryEnqueueAsync(evt);
                }
                catch
                {
                    Dropped.Add(1);
                }
            });

            Enqueued.Add(1);
            return true;
        }
        catch (Exception ex)
        {
            // Best-effort only; never throw to callers.
            Dropped.Add(1);
            _logger.LogDebug(ex, "Audit enqueue failed");
            return false;
        }
    }

    private void Normalize(AuditEvent evt)
    {
        evt.Id = evt.Id == Guid.Empty ? Guid.NewGuid() : evt.Id;
        evt.TimestampUtc = evt.TimestampUtc == default ? DateTime.UtcNow : evt.TimestampUtc;

        evt.Kind = NormalizeTrim(evt.Kind, 16) ?? "activity";
        evt.EventName = NormalizeTrim(evt.EventName, 128) ?? string.Empty;
        evt.Category = NormalizeTrim(evt.Category, 64);
        evt.Message = NormalizeTrim(evt.Message, 512);
        evt.Source = NormalizeTrim(evt.Source, 16);

        evt.ActorType = NormalizeTrim(evt.ActorType, 32);
        evt.ActorId = NormalizeTrim(evt.ActorId, 128);
        evt.ActorName = NormalizeTrim(evt.ActorName, 128);
        evt.ActorIp = NormalizeTrim(evt.ActorIp, 64);
        evt.UserAgent = NormalizeTrim(evt.UserAgent, 256);

        evt.HttpMethod = NormalizeTrim(evt.HttpMethod, 16);
        evt.HttpPath = NormalizeTrim(evt.HttpPath, 512);

        evt.Hub = NormalizeTrim(evt.Hub, 64);
        evt.HubMethod = NormalizeTrim(evt.HubMethod, 128);
        evt.ConnectionId = NormalizeTrim(evt.ConnectionId, 128);

        evt.RequestId = NormalizeTrim(evt.RequestId, 64);
        evt.TraceId = NormalizeTrim(evt.TraceId, 32);
        evt.SpanId = NormalizeTrim(evt.SpanId, 16);

        evt.Error = NormalizeTrim(evt.Error, 2048);

        evt.DataJson = NormalizeDataJson(evt.DataJson);
    }

    private string? NormalizeDataJson(string? json)
    {
        if (string.IsNullOrWhiteSpace(json))
        {
            return null;
        }

        json = json.Trim();
        if (json.Length == 0)
        {
            return null;
        }

        // Keep data small and defensively valid.
        var maxBytes = Math.Max(256, _options.CurrentValue.MaxDataJsonBytesUtf8);
        if (Encoding.UTF8.GetByteCount(json) > maxBytes)
        {
            return "{\"_truncated\":true}";
        }

        // Basic sanity check; avoid full parse on hot paths.
        var c = json[0];
        if (c is not '{' and not '[')
        {
            return null;
        }

        // Optional lightweight validation in debug builds.
        DebugValidateJson(json);
        return json;
    }

    [Conditional("DEBUG")]
    private static void DebugValidateJson(string json)
    {
        try
        {
            using var _ = JsonDocument.Parse(json);
        }
        catch
        {
            // Ignore invalid json in debug; NormalizeDataJson will still accept it.
            // We keep this method for local dev visibility only.
        }
    }

    private static string? NormalizeTrim(string? s, int maxLen)
    {
        if (string.IsNullOrWhiteSpace(s)) return null;
        s = s.Trim();
        if (s.Length == 0) return null;
        return s.Length <= maxLen ? s : s[..maxLen];
    }
}
