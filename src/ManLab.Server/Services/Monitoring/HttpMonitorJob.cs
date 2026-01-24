using System.Diagnostics;
using System.Net.Security;
using System.Security.Cryptography.X509Certificates;
using ManLab.Server.Data;
using ManLab.Server.Data.Entities.Enhancements;
using ManLab.Server.Services.Network;
using Microsoft.EntityFrameworkCore;
using Quartz;

namespace ManLab.Server.Services.Monitoring;

[DisallowConcurrentExecution]
public sealed class HttpMonitorJob : IJob
{
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly ILogger<HttpMonitorJob> _logger;
    private readonly INetworkToolHistoryService _history;

    public HttpMonitorJob(
        IServiceScopeFactory scopeFactory,
        ILogger<HttpMonitorJob> logger,
        INetworkToolHistoryService history)
    {
        _scopeFactory = scopeFactory;
        _logger = logger;
        _history = history;
    }

    public async Task Execute(IJobExecutionContext context)
    {
        if (!context.MergedJobDataMap.TryGetValue("monitorId", out var idObj) ||
            !Guid.TryParse(idObj?.ToString(), out var monitorId))
        {
            _logger.LogWarning("HTTP monitor job executed without a valid monitorId");
            return;
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DataContext>();

        var config = await db.HttpMonitorConfigs
            .FirstOrDefaultAsync(c => c.Id == monitorId, context.CancellationToken)
            .ConfigureAwait(false);

        if (config is null || !config.Enabled)
        {
            return;
        }

        var sw = Stopwatch.StartNew();
        int? statusCode = null;
        bool success = false;
        bool? keywordMatched = null;
        int? sslDaysRemaining = null;
        string? errorMessage = null;

        try
        {
            using var handler = new HttpClientHandler();
            X509Certificate2? cert = null;
            handler.ServerCertificateCustomValidationCallback = (_, certificate, _, sslPolicyErrors) =>
            {
                if (certificate is not null)
                {
                    cert = new X509Certificate2(certificate);
                }

                return sslPolicyErrors == SslPolicyErrors.None;
            };

            using var client = new HttpClient(handler)
            {
                Timeout = TimeSpan.FromMilliseconds(Math.Clamp(config.TimeoutMs, 500, 30000))
            };

            using var request = new HttpRequestMessage(new HttpMethod(config.Method ?? "GET"), config.Url);
            using var response = await client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, context.CancellationToken)
                .ConfigureAwait(false);

            statusCode = (int)response.StatusCode;

            if (!string.IsNullOrWhiteSpace(config.BodyContains))
            {
                var body = await response.Content.ReadAsStringAsync(context.CancellationToken).ConfigureAwait(false);
                keywordMatched = body.Contains(config.BodyContains, StringComparison.OrdinalIgnoreCase);
            }

            var expected = config.ExpectedStatus;
            if (expected.HasValue)
            {
                success = statusCode == expected.Value;
            }
            else
            {
                success = response.IsSuccessStatusCode;
            }

            if (keywordMatched.HasValue)
            {
                success = success && keywordMatched.Value;
            }

            if (cert is not null)
            {
                sslDaysRemaining = (int)Math.Floor((cert.NotAfter.ToUniversalTime() - DateTime.UtcNow).TotalDays);
            }
        }
        catch (Exception ex)
        {
            errorMessage = ex.Message;
            _logger.LogWarning(ex, "HTTP monitor check failed for {MonitorId}", monitorId);
        }
        finally
        {
            sw.Stop();
        }

        var check = new HttpMonitorCheck
        {
            MonitorId = monitorId,
            TimestampUtc = DateTime.UtcNow,
            StatusCode = statusCode,
            Success = success,
            ResponseTimeMs = (int)sw.ElapsedMilliseconds,
            KeywordMatched = keywordMatched,
            SslDaysRemaining = sslDaysRemaining,
            ErrorMessage = errorMessage
        };

        config.LastRunAtUtc = check.TimestampUtc;
        if (success)
        {
            config.LastSuccessAtUtc = check.TimestampUtc;
        }
        config.UpdatedAt = DateTime.UtcNow;

        db.HttpMonitorChecks.Add(check);
        await db.SaveChangesAsync(context.CancellationToken).ConfigureAwait(false);

        _ = _history.RecordAsync(
            toolType: "monitor-http",
            target: config.Url,
            input: new
            {
                config.Name,
                config.Url,
                config.Method,
                config.ExpectedStatus,
                config.BodyContains,
                config.TimeoutMs,
                config.Cron
            },
            result: new
            {
                StatusCode = statusCode,
                ResponseTimeMs = check.ResponseTimeMs,
                KeywordMatched = keywordMatched,
                SslDaysRemaining = sslDaysRemaining
            },
            success: success,
            durationMs: (int)sw.ElapsedMilliseconds,
            error: errorMessage);
    }
}
