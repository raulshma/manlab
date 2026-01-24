using System.Net;

namespace ManLab.Server.Services.Network;

public sealed record SyslogOptions
{
    public const string SectionName = "Syslog";

    public bool Enabled { get; init; } = true;
    public int Port { get; init; } = 514;
    public int MaxBufferedMessages { get; init; } = 2000;
}

public sealed record SyslogStatus
{
    public bool Enabled { get; init; }
    public bool IsListening { get; init; }
    public int Port { get; init; }
    public string? Error { get; init; }
    public int BufferedCount { get; init; }
    public long DroppedCount { get; init; }
}

public sealed record SyslogMessage
{
    public long Id { get; init; }
    public DateTime ReceivedAtUtc { get; init; }
    public int? Facility { get; init; }
    public int? Severity { get; init; }
    public string? Host { get; init; }
    public string? AppName { get; init; }
    public string? ProcId { get; init; }
    public string? MsgId { get; init; }
    public string Message { get; init; } = string.Empty;
    public string Raw { get; init; } = string.Empty;
    public string? SourceIp { get; init; }
    public int? SourcePort { get; init; }
}

public interface ISyslogMessageStore
{
    SyslogStatus GetStatus();
    IReadOnlyList<SyslogMessage> GetRecent(int count);
    void Clear();
}
