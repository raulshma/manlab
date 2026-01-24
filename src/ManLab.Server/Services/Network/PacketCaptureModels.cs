namespace ManLab.Server.Services.Network;

public sealed record PacketCaptureOptions
{
    public const string SectionName = "PacketCapture";

    public bool Enabled { get; init; } = true;
    public int MaxBufferedPackets { get; init; } = 2000;
    public int SnapLength { get; init; } = 65535;
    public bool Promiscuous { get; init; } = true;
    public int BroadcastBatchSize { get; init; } = 50;
    public int BroadcastIntervalMs { get; init; } = 150;
    public int BroadcastSampleEvery { get; init; } = 1;
}

public sealed record PacketCaptureStatus
{
    public bool Enabled { get; init; }
    public bool PcapAvailable { get; init; }
    public bool IsCapturing { get; init; }
    public string? DeviceName { get; init; }
    public string? Filter { get; init; }
    public string? Error { get; init; }
    public int BufferedCount { get; init; }
    public long DroppedCount { get; init; }
}

public sealed record PacketCaptureDeviceInfo
{
    public string Name { get; init; } = string.Empty;
    public string? Description { get; init; }
    public bool IsLoopback { get; init; }
}

public sealed record PacketCaptureRecord
{
    public long Id { get; init; }
    public DateTime CapturedAtUtc { get; init; }
    public string? Source { get; init; }
    public string? Destination { get; init; }
    public string? Protocol { get; init; }
    public int Length { get; init; }
    public int? SourcePort { get; init; }
    public int? DestinationPort { get; init; }
    public string? SourceMac { get; init; }
    public string? DestinationMac { get; init; }
    public string? Info { get; init; }
}

public sealed record PacketCaptureStartRequest
{
    public string? DeviceName { get; init; }
    public string? Filter { get; init; }
}

public interface IPacketCaptureService
{
    PacketCaptureStatus GetStatus();
    IReadOnlyList<PacketCaptureDeviceInfo> GetDevices();
    IReadOnlyList<PacketCaptureRecord> GetRecent(int count);
    Task<PacketCaptureStatus> StartCaptureAsync(PacketCaptureStartRequest request, CancellationToken ct);
    Task<PacketCaptureStatus> StopCaptureAsync(CancellationToken ct);
    void Clear();
}
