using System.Net.Http.Json;
using ManLab.Server.Data.Entities;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services;

/// <summary>
/// Sends alerts to Discord via an incoming webhook.
/// </summary>
public sealed class DiscordWebhookNotificationService : INotificationService
{
    private readonly ILogger<DiscordWebhookNotificationService> _logger;
    private readonly IHttpClientFactory _httpClientFactory;
    private readonly IOptionsMonitor<DiscordOptions> _options;

    public DiscordWebhookNotificationService(
        ILogger<DiscordWebhookNotificationService> logger,
        IHttpClientFactory httpClientFactory,
        IOptionsMonitor<DiscordOptions> options)
    {
        _logger = logger;
        _httpClientFactory = httpClientFactory;
        _options = options;
    }

    public async Task NotifyNodeOfflineAsync(Node node, CancellationToken cancellationToken = default)
    {
        var webhookUrl = _options.CurrentValue.WebhookUrl;
        if (string.IsNullOrWhiteSpace(webhookUrl))
        {
            _logger.LogDebug("Discord webhook not configured; skipping offline notification for node {NodeId} ({Hostname})",
                node.Id,
                node.Hostname);
            return;
        }

        var content = $"🚨 **ManLab Alert**\n" +
                      $"Node **{node.Hostname}** is **OFFLINE** (no heartbeat > 2 minutes).\n" +
                      $"- Id: `{node.Id}`\n" +
                      $"- IP: `{node.IpAddress ?? "unknown"}`\n" +
                      $"- OS: `{node.OS ?? "unknown"}`\n" +
                      $"- LastSeen (UTC): `{node.LastSeen:O}`";

        var payload = new
        {
            content,
            username = "ManLab",
            allowed_mentions = new { parse = Array.Empty<string>() }
        };

        try
        {
            var client = _httpClientFactory.CreateClient();
            using var response = await client.PostAsJsonAsync(webhookUrl, payload, cancellationToken);

            if (!response.IsSuccessStatusCode)
            {
                var body = await response.Content.ReadAsStringAsync(cancellationToken);
                _logger.LogWarning("Discord webhook returned {StatusCode}. Body: {Body}", (int)response.StatusCode, body);
            }
        }
        catch (OperationCanceledException)
        {
            // normal cancellation
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send Discord offline alert for node {NodeId}", node.Id);
        }
    }
}
