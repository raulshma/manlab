namespace ManLab.Server.Services.Network;

/// <summary>
/// Represents a WiFi network discovered during a scan.
/// </summary>
public record WifiNetwork
{
    /// <summary>
    /// The SSID (network name).
    /// </summary>
    public required string Ssid { get; init; }

    /// <summary>
    /// The BSSID (MAC address of the access point).
    /// </summary>
    public string? Bssid { get; init; }

    /// <summary>
    /// Signal strength in dBm (typically -30 to -90).
    /// </summary>
    public int? SignalStrengthDbm { get; init; }

    /// <summary>
    /// Signal quality as a percentage (0-100).
    /// </summary>
    public int? SignalQualityPercent { get; init; }

    /// <summary>
    /// The channel the network is broadcasting on.
    /// </summary>
    public int? Channel { get; init; }

    /// <summary>
    /// The frequency in MHz (e.g., 2412 for channel 1, 5180 for channel 36).
    /// </summary>
    public int? FrequencyMhz { get; init; }

    /// <summary>
    /// The WiFi band (2.4 GHz, 5 GHz, or 6 GHz).
    /// </summary>
    public string? Band { get; init; }

    /// <summary>
    /// The security type(s) of the network.
    /// </summary>
    public List<string> Security { get; init; } = [];

    /// <summary>
    /// Whether the network is secured (has authentication).
    /// </summary>
    public bool IsSecured { get; init; }

    /// <summary>
    /// Network mode (Infrastructure, Ad-hoc, etc.).
    /// </summary>
    public string? NetworkType { get; init; }

    /// <summary>
    /// Whether this is the currently connected network.
    /// </summary>
    public bool IsConnected { get; init; }

    /// <summary>
    /// The 802.11 standard (a, b, g, n, ac, ax).
    /// </summary>
    public string? Standard { get; init; }

    /// <summary>
    /// When this network was discovered.
    /// </summary>
    public DateTime DiscoveredAt { get; init; } = DateTime.UtcNow;
}

/// <summary>
/// Information about a WiFi adapter/interface.
/// </summary>
public record WifiAdapter
{
    /// <summary>
    /// The interface name (e.g., "wlan0", "Wi-Fi").
    /// </summary>
    public required string Name { get; init; }

    /// <summary>
    /// A description of the adapter.
    /// </summary>
    public string? Description { get; init; }

    /// <summary>
    /// The GUID/ID of the interface (Windows).
    /// </summary>
    public string? Id { get; init; }

    /// <summary>
    /// The current state of the interface.
    /// </summary>
    public string? State { get; init; }

    /// <summary>
    /// Whether this adapter supports scanning.
    /// </summary>
    public bool CanScan { get; init; }

    /// <summary>
    /// MAC address of the adapter.
    /// </summary>
    public string? MacAddress { get; init; }
}

/// <summary>
/// Result of a WiFi scan operation.
/// </summary>
public record WifiScanResult
{
    /// <summary>
    /// The adapter used for scanning.
    /// </summary>
    public WifiAdapter? Adapter { get; init; }

    /// <summary>
    /// List of discovered networks.
    /// </summary>
    public List<WifiNetwork> Networks { get; init; } = [];

    /// <summary>
    /// When the scan started.
    /// </summary>
    public DateTime StartedAt { get; init; }

    /// <summary>
    /// When the scan completed.
    /// </summary>
    public DateTime CompletedAt { get; init; }

    /// <summary>
    /// Duration of the scan in milliseconds.
    /// </summary>
    public long DurationMs => (long)(CompletedAt - StartedAt).TotalMilliseconds;

    /// <summary>
    /// Whether the scan was successful.
    /// </summary>
    public bool Success { get; init; }

    /// <summary>
    /// Error message if the scan failed.
    /// </summary>
    public string? ErrorMessage { get; init; }

    /// <summary>
    /// Platform-specific details about the scan.
    /// </summary>
    public string? Platform { get; init; }
}

/// <summary>
/// Helper methods for WiFi frequency and channel calculations.
/// </summary>
public static class WifiHelpers
{
    /// <summary>
    /// Converts a 2.4 GHz or 5 GHz channel to frequency in MHz.
    /// </summary>
    public static int ChannelToFrequency(int channel)
    {
        // 2.4 GHz band (channels 1-14)
        if (channel >= 1 && channel <= 13)
        {
            return 2412 + (channel - 1) * 5;
        }
        if (channel == 14)
        {
            return 2484;
        }

        // 5 GHz band
        if (channel >= 36 && channel <= 64)
        {
            return 5180 + (channel - 36) * 5;
        }
        if (channel >= 100 && channel <= 144)
        {
            return 5500 + (channel - 100) * 5;
        }
        if (channel >= 149 && channel <= 165)
        {
            return 5745 + (channel - 149) * 5;
        }

        // 6 GHz band (WiFi 6E)
        if (channel >= 1 && channel <= 233)
        {
            return 5955 + channel * 5;
        }

        return 0;
    }

    /// <summary>
    /// Converts a frequency in MHz to a channel number.
    /// </summary>
    public static int FrequencyToChannel(int frequencyMhz)
    {
        // 2.4 GHz band
        if (frequencyMhz >= 2412 && frequencyMhz <= 2472)
        {
            return (frequencyMhz - 2412) / 5 + 1;
        }
        if (frequencyMhz == 2484)
        {
            return 14;
        }

        // 5 GHz band
        if (frequencyMhz >= 5180 && frequencyMhz <= 5320)
        {
            return (frequencyMhz - 5180) / 5 + 36;
        }
        if (frequencyMhz >= 5500 && frequencyMhz <= 5720)
        {
            return (frequencyMhz - 5500) / 5 + 100;
        }
        if (frequencyMhz >= 5745 && frequencyMhz <= 5825)
        {
            return (frequencyMhz - 5745) / 5 + 149;
        }

        // 6 GHz band
        if (frequencyMhz >= 5955 && frequencyMhz <= 7115)
        {
            return (frequencyMhz - 5955) / 5;
        }

        return 0;
    }

    /// <summary>
    /// Gets the band name for a frequency.
    /// </summary>
    public static string GetBand(int frequencyMhz)
    {
        if (frequencyMhz >= 2400 && frequencyMhz < 2500)
        {
            return "2.4 GHz";
        }
        if (frequencyMhz >= 5000 && frequencyMhz < 5900)
        {
            return "5 GHz";
        }
        if (frequencyMhz >= 5925 && frequencyMhz <= 7125)
        {
            return "6 GHz";
        }
        return "Unknown";
    }

    /// <summary>
    /// Converts signal strength from percentage to dBm (approximate).
    /// </summary>
    public static int PercentToDbm(int percent)
    {
        // Common approximation: dBm = (percentage / 2) - 100
        return (percent / 2) - 100;
    }

    /// <summary>
    /// Converts signal strength from dBm to percentage (approximate).
    /// </summary>
    public static int DbmToPercent(int dbm)
    {
        // Common approximation
        if (dbm >= -50) return 100;
        if (dbm <= -100) return 0;
        return 2 * (dbm + 100);
    }
}
