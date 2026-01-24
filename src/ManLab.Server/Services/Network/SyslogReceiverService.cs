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
    private static readonly Regex Rfc5424Regex = new(
        "^<(?<pri>\\d+)>(?<version>\\d+) (?<ts>[^ ]+) (?<host>[^ ]+) (?<app>[^ ]+) (?<proc>[^ ]+) (?<msgid>[^ ]+) (?<msg>.*)$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private static readonly Regex Rfc3164Regex = new(
        "^<(?<pri>\\d+)>(?<ts>[A-Z][a-z]{2}\\s+\\d{1,2}\\s+\\d{2}:\\d{2}:\\d{2})\\s+(?<host>[^ ]+)\\s+(?<msg>.*)$",
        RegexOptions.Compiled | RegexOptions.CultureInvariant);

    private readonly IHubContext<NetworkHub> _hubContext;
    private readonly ILogger<SyslogReceiverService> _logger;
    private readonly SyslogOptions _options;
    private readonly object _gate = new();
    private readonly List<SyslogMessage> _messages = [];
    private long _nextId;
    private long _droppedCount;
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
                BufferedCount = _messages.Count,
                DroppedCount = _droppedCount
            };
        }
    }

    public IReadOnlyList<SyslogMessage> GetRecent(int count)
    {
        count = Math.Clamp(count, 1, 2000);
        lock (_gate)
        {
            if (_messages.Count == 0)
            {
                return [];
            }

            var skip = Math.Max(0, _messages.Count - count);
            return _messages.Skip(skip).ToList();
        }
    }

    public void Clear()
    {
        lock (_gate)
        {
            _messages.Clear();
            _droppedCount = 0;
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
                var payload = Encoding.UTF8.GetString(result.Buffer);
                var message = ParseMessage(payload, result.RemoteEndPoint);

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
            _messages.Add(message);
            var max = Math.Max(100, _options.MaxBufferedMessages);
            if (_messages.Count > max)
            {
                var overflow = _messages.Count - max;
                _messages.RemoveRange(0, overflow);
                _droppedCount += overflow;
            }
        }
    }

    private SyslogMessage ParseMessage(string payload, IPEndPoint source)
    {
        var receivedAt = DateTime.UtcNow;
        int? facility = null;
        int? severity = null;
        string? host = null;
        string? app = null;
        string? procId = null;
        string? msgId = null;
        string message = payload.TrimEnd();

        var match5424 = Rfc5424Regex.Match(payload);
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
            var match3164 = Rfc3164Regex.Match(payload);
            if (match3164.Success)
            {
                ParsePri(match3164.Groups["pri"].Value, out facility, out severity);
                host = match3164.Groups["host"].Value;
                var rawMessage = match3164.Groups["msg"].Value.Trim();
                ExtractAppInfoFrom3164(rawMessage, out app, out procId, out message);
            }
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
            Raw = payload.TrimEnd(),
            SourceIp = source.Address.ToString(),
            SourcePort = source.Port
        };
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
