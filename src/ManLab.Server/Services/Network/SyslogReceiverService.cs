using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.RegularExpressions;
using ManLab.Server.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.Options;

namespace ManLab.Server.Services.Network;

public sealed class SyslogReceiverService : BackgroundService, ISyslogMessageStore
{
    private readonly Regex _rfc5424Regex;
    private readonly Regex _rfc3164Regex;

    private readonly IHubContext<NetworkHub> _hubContext;
    private readonly ILogger<SyslogReceiverService> _logger;
    private readonly SyslogOptions _options;
    private readonly Lock _gate = new();
    private CircularBuffer<SyslogMessage>? _messages;
    private long _nextId;
    private SyslogStatus _status;
    private UdpClient? _client;

    public SyslogReceiverService(
        IOptions<SyslogOptions> options,
        IHubContext<NetworkHub> hubContext,
        ILogger<SyslogReceiverService> logger)
    {
        _options = options.Value;
        _hubContext = hubContext;
        _logger = logger;
        var regexTimeout = TimeSpan.FromMilliseconds(Math.Clamp(_options.RegexTimeoutMs, 50, 2000));
        _rfc5424Regex = new Regex(
            "^<(?<pri>\\d+)>(?<version>\\d+) (?<ts>[^ ]+) (?<host>[^ ]+) (?<app>[^ ]+) (?<proc>[^ ]+) (?<msgid>[^ ]+) (?<msg>.*)$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant,
            regexTimeout);
        _rfc3164Regex = new Regex(
            "^<(?<pri>\\d+)>(?<ts>[A-Z][a-z]{2}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+(?<host>[^ ]+)\\s+(?<msg>.*)$",
            RegexOptions.Compiled | RegexOptions.CultureInvariant,
            regexTimeout);
        _status = new SyslogStatus
        {
            Enabled = _options.Enabled,
            IsListening = false,
            Port = _options.Port,
            Error = _options.Enabled ? null : "Syslog receiver disabled",
            BufferedCount = 0,
            DroppedCount = 0
        };
    }

    public SyslogStatus GetStatus()
    {
        lock (_gate)
        {
            return _status with
            {
                BufferedCount = _messages?.Count ?? 0,
                DroppedCount = _messages?.DroppedCount ?? 0
            };
        }
    }

    public IReadOnlyList<SyslogMessage> GetRecent(int count)
    {
        count = Math.Clamp(count, 1, 2000);
        lock (_gate)
        {
            if (_messages is null || _messages.Count == 0)
            {
                return [];
            }
            return _messages.GetRecent(count);
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _messages?.Reset();
        }
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        if (!_options.Enabled)
        {
            _logger.LogInformation("Syslog receiver is disabled.");
            return;
        }

        try
        {
            _client = new UdpClient(_options.Port);
            lock (_gate)
            {
                _status = _status with
                {
                    IsListening = true,
                    Error = null
                };
            }

            _logger.LogInformation("Syslog receiver listening on UDP {Port}", _options.Port);
        }
        catch (Exception ex)
        {
            lock (_gate)
            {
                _status = _status with
                {
                    IsListening = false,
                    Error = ex.Message
                };
            }
            _logger.LogError(ex, "Failed to start syslog receiver on UDP {Port}", _options.Port);
            return;
        }

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                var result = await _client.ReceiveAsync(stoppingToken).ConfigureAwait(false);
                var truncated = false;
                var buffer = result.Buffer;
                var maxPayload = Math.Clamp(_options.MaxPayloadBytes, 1024, 131072);
                if (buffer.Length > maxPayload)
                {
                    truncated = true;
                    buffer = buffer.AsSpan(0, maxPayload).ToArray();
                }

                var payload = Encoding.UTF8.GetString(buffer);
                var message = ParseMessage(payload, result.RemoteEndPoint, truncated);

                AddMessage(message);

                await _hubContext.Clients
                    .Group(NetworkHub.SyslogGroup)
                    .SendAsync("SyslogMessage", message, stoppingToken)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Syslog receiver error");
                lock (_gate)
                {
                    _status = _status with { Error = ex.Message };
                }
            }
        }
    }

    public override Task StopAsync(CancellationToken cancellationToken)
    {
        try
        {
            _client?.Close();
            _client?.Dispose();
        }
        catch
        {
            // ignore
        }

        lock (_gate)
        {
            _status = _status with { IsListening = false };
        }

        return base.StopAsync(cancellationToken);
    }

    private void AddMessage(SyslogMessage message)
    {
        lock (_gate)
        {
            // Lazy initialization with configured capacity
            _messages ??= new CircularBuffer<SyslogMessage>(Math.Max(100, _options.MaxBufferedMessages));
            _messages.Add(message);
        }
    }

    private SyslogMessage ParseMessage(string payload, IPEndPoint source, bool truncated)
    {
        var receivedAt = DateTime.UtcNow;
        int? facility = null;
        int? severity = null;
        string? host = null;
        string? app = null;
        string? procId = null;
        string? msgId = null;
        string message = payload.TrimEnd();

        try
        {
            var match5424 = _rfc5424Regex.Match(payload);
            if (match5424.Success)
            {
                var pri = ParsePri(match5424.Groups["pri"].Value, out facility, out severity);
                _ = pri;
                host = match5424.Groups["host"].Value;
                app = NormalizeNil(match5424.Groups["app"].Value);
                procId = NormalizeNil(match5424.Groups["proc"].Value);
                msgId = NormalizeNil(match5424.Groups["msgid"].Value);
                message = match5424.Groups["msg"].Value.Trim();
            }
            else
            {
                var match3164 = _rfc3164Regex.Match(payload);
                if (match3164.Success)
                {
                    ParsePri(match3164.Groups["pri"].Value, out facility, out severity);
                    host = match3164.Groups["host"].Value;
                    var rawMessage = match3164.Groups["msg"].Value.Trim();
                    ExtractAppInfoFrom3164(rawMessage, out app, out procId, out message);
                }
            }
        }
        catch (RegexMatchTimeoutException ex)
        {
            _logger.LogWarning(ex, "Syslog payload regex timed out");
            return BuildFallbackMessage(payload, source, receivedAt, truncated, "regex_timeout");
        }

        if (string.Equals(message, payload.TrimEnd(), StringComparison.Ordinal) &&
            string.IsNullOrWhiteSpace(host) && string.IsNullOrWhiteSpace(app) && string.IsNullOrWhiteSpace(procId))
        {
            return BuildFallbackMessage(payload, source, receivedAt, truncated, "unparsed");
        }

        return new SyslogMessage
        {
            Id = Interlocked.Increment(ref _nextId),
            ReceivedAtUtc = receivedAt,
            Facility = facility,
            Severity = severity,
            Host = host,
            AppName = app,
            ProcId = procId,
            MsgId = msgId,
            Message = message,
            Raw = BuildSafeRaw(payload, truncated),
            SourceIp = source.Address.ToString(),
            SourcePort = source.Port
        };
    }

    private SyslogMessage BuildFallbackMessage(
        string payload,
        IPEndPoint source,
        DateTime receivedAt,
        bool truncated,
        string reason)
    {
        var raw = BuildSafeRaw(payload, truncated);
        var displayMessage = string.IsNullOrWhiteSpace(raw) ? $"[syslog {reason}]" : raw;

        return new SyslogMessage
        {
            Id = Interlocked.Increment(ref _nextId),
            ReceivedAtUtc = receivedAt,
            Facility = null,
            Severity = null,
            Host = null,
            AppName = null,
            ProcId = null,
            MsgId = null,
            Message = displayMessage,
            Raw = raw,
            SourceIp = source.Address.ToString(),
            SourcePort = source.Port
        };
    }

    private static string BuildSafeRaw(string payload, bool truncated)
    {
        var raw = payload.TrimEnd();
        return truncated ? $"{raw} [truncated]" : raw;
    }

    private static void ExtractAppInfoFrom3164(string rawMessage, out string? app, out string? procId, out string message)
    {
        app = null;
        procId = null;
        message = rawMessage;

        var colonIndex = rawMessage.IndexOf(':');
        if (colonIndex <= 0)
        {
            return;
        }

        var prefix = rawMessage[..colonIndex];
        message = rawMessage[(colonIndex + 1)..].Trim();

        var bracketIndex = prefix.IndexOf('[');
        if (bracketIndex > 0 && prefix.EndsWith(']'))
        {
            app = prefix[..bracketIndex];
            procId = prefix[(bracketIndex + 1)..^1];
        }
        else
        {
            app = prefix;
        }
    }

    private static string? NormalizeNil(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value == "-")
        {
            return null;
        }
        return value;
    }

    private static int? ParsePri(string value, out int? facility, out int? severity)
    {
        facility = null;
        severity = null;

        if (!int.TryParse(value, out var pri))
        {
            return null;
        }

        facility = pri / 8;
        severity = pri % 8;
        return pri;
    }
}
