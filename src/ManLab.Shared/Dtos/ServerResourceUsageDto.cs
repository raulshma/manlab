namespace ManLab.Shared.Dtos;

/// <summary>
/// Server process resource usage metrics sent to dashboard clients.
/// </summary>
public sealed class ServerResourceUsageDto
{
    public DateTime TimestampUtc { get; set; }
    public float? CpuPercent { get; set; }
    public long? MemoryBytes { get; set; }
    public long? GcHeapBytes { get; set; }
    public int? ThreadCount { get; set; }
}
