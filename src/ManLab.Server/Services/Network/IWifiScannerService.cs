namespace ManLab.Server.Services.Network;

/// <summary>
/// Service interface for WiFi network scanning.
/// </summary>
public interface IWifiScannerService
{
    /// <summary>
    /// Gets whether WiFi scanning is supported on this platform.
    /// </summary>
    bool IsSupported { get; }

    /// <summary>
    /// Gets the list of available WiFi adapters.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>List of WiFi adapters.</returns>
    Task<List<WifiAdapter>> GetAdaptersAsync(CancellationToken ct = default);

    /// <summary>
    /// Scans for available WiFi networks.
    /// </summary>
    /// <param name="adapterName">Optional adapter name to use for scanning.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>WiFi scan result.</returns>
    Task<WifiScanResult> ScanAsync(string? adapterName = null, CancellationToken ct = default);
}
