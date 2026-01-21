namespace ManLab.Server.Services.Network;

/// <summary>
/// Fallback WiFi scanner implementation for unsupported platforms.
/// </summary>
public sealed class UnsupportedWifiScannerService : IWifiScannerService
{
    /// <inheritdoc />
    public bool IsSupported => false;

    /// <inheritdoc />
    public Task<List<WifiAdapter>> GetAdaptersAsync(CancellationToken ct = default)
    {
        return Task.FromResult(new List<WifiAdapter>());
    }

    /// <inheritdoc />
    public Task<WifiScanResult> ScanAsync(string? adapterName = null, CancellationToken ct = default)
    {
        return Task.FromResult(new WifiScanResult
        {
            StartedAt = DateTime.UtcNow,
            CompletedAt = DateTime.UtcNow,
            Success = false,
            ErrorMessage = "WiFi scanning is not supported on this platform",
            Platform = Environment.OSVersion.Platform.ToString()
        });
    }
}
