namespace ManLab.Server.Services.Network;

/// <summary>
/// Configuration options for internet speed testing.
/// </summary>
public sealed class SpeedTestOptions
{
    public const string SectionName = "SpeedTest";

    /// <summary>
    /// M-Lab locate service base URL.
    /// </summary>
    public string LocateBaseUrl { get; init; } = "https://locate.measurementlab.net";

    /// <summary>
    /// Locate service name (e.g. "ndt").
    /// </summary>
    public string ServiceName { get; init; } = "ndt";

    /// <summary>
    /// Locate service type (e.g. "ndt7").
    /// </summary>
    public string ServiceType { get; init; } = "ndt7";

    /// <summary>
    /// Optional client name metadata sent to the server.
    /// </summary>
    public string ClientName { get; init; } = "manlab";

    /// <summary>
    /// Optional client version metadata sent to the server.
    /// </summary>
    public string? ClientVersion { get; init; }

    /// <summary>
    /// Optional client library name metadata sent to the server.
    /// </summary>
    public string ClientLibraryName { get; init; } = "manlab-server";

    /// <summary>
    /// Optional client library version metadata sent to the server.
    /// </summary>
    public string? ClientLibraryVersion { get; init; }

    /// <summary>
    /// Default download size in bytes.
    /// </summary>
    public int DownloadSizeBytes { get; init; } = 10_000_000;

    /// <summary>
    /// Default upload size in bytes.
    /// </summary>
    public int UploadSizeBytes { get; init; } = 5_000_000;

    /// <summary>
    /// Default number of latency samples.
    /// </summary>
    public int LatencySamples { get; init; } = 3;

    /// <summary>
    /// Max size for upload/download in bytes.
    /// </summary>
    public int MaxSizeBytes { get; init; } = 50_000_000;

    /// <summary>
    /// Max test duration in seconds (ndt7 servers typically end around 10s).
    /// </summary>
    public int MaxTestSeconds { get; init; } = 13;

    /// <summary>
    /// Timeout for locate API calls, in seconds.
    /// </summary>
    public int LocateTimeoutSeconds { get; init; } = 15;
}
