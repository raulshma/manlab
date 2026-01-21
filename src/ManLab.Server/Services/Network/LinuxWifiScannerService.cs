using System.Diagnostics;
using System.Runtime.Versioning;
using System.Text.RegularExpressions;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Linux implementation of WiFi scanner using nmcli or iwlist commands.
/// </summary>
[SupportedOSPlatform("linux")]
public sealed partial class LinuxWifiScannerService : IWifiScannerService
{
    private readonly ILogger<LinuxWifiScannerService> _logger;

    public LinuxWifiScannerService(ILogger<LinuxWifiScannerService> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public bool IsSupported => OperatingSystem.IsLinux();

    /// <inheritdoc />
    public async Task<List<WifiAdapter>> GetAdaptersAsync(CancellationToken ct = default)
    {
        if (!OperatingSystem.IsLinux())
        {
            return [];
        }

        var adapters = new List<WifiAdapter>();

        try
        {
            // Try to get wireless interfaces from /sys/class/net
            if (Directory.Exists("/sys/class/net"))
            {
                foreach (var netDir in Directory.GetDirectories("/sys/class/net"))
                {
                    var interfaceName = Path.GetFileName(netDir);
                    var wirelessPath = Path.Combine(netDir, "wireless");
                    
                    if (Directory.Exists(wirelessPath))
                    {
                        // It's a wireless interface
                        string? macAddress = null;
                        string? state = null;

                        var addressPath = Path.Combine(netDir, "address");
                        if (File.Exists(addressPath))
                        {
                            macAddress = (await File.ReadAllTextAsync(addressPath, ct)).Trim().ToUpperInvariant();
                        }

                        var operstatePath = Path.Combine(netDir, "operstate");
                        if (File.Exists(operstatePath))
                        {
                            state = (await File.ReadAllTextAsync(operstatePath, ct)).Trim();
                        }

                        adapters.Add(new WifiAdapter
                        {
                            Name = interfaceName,
                            Description = $"Wireless interface {interfaceName}",
                            State = state,
                            MacAddress = macAddress,
                            CanScan = true
                        });
                    }
                }
            }

            // If no adapters found, try nmcli
            if (adapters.Count == 0)
            {
                var output = await RunCommandAsync("nmcli", "-t -f DEVICE,TYPE,STATE device", ct);
                if (!string.IsNullOrEmpty(output))
                {
                    foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
                    {
                        var parts = line.Split(':');
                        if (parts.Length >= 3 && parts[1].Equals("wifi", StringComparison.OrdinalIgnoreCase))
                        {
                            adapters.Add(new WifiAdapter
                            {
                                Name = parts[0],
                                Description = "WiFi adapter",
                                State = parts[2],
                                CanScan = true
                            });
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Error getting WiFi adapters");
        }

        return adapters;
    }

    /// <inheritdoc />
    public async Task<WifiScanResult> ScanAsync(string? adapterName = null, CancellationToken ct = default)
    {
        var startedAt = DateTime.UtcNow;

        if (!OperatingSystem.IsLinux())
        {
            return new WifiScanResult
            {
                StartedAt = startedAt,
                CompletedAt = DateTime.UtcNow,
                Success = false,
                ErrorMessage = "WiFi scanning is only supported on Linux",
                Platform = "Linux"
            };
        }

        // Get adapter to use
        var adapters = await GetAdaptersAsync(ct);
        var adapter = adapterName != null 
            ? adapters.FirstOrDefault(a => a.Name.Equals(adapterName, StringComparison.OrdinalIgnoreCase))
            : adapters.FirstOrDefault();

        if (adapter == null)
        {
            return new WifiScanResult
            {
                StartedAt = startedAt,
                CompletedAt = DateTime.UtcNow,
                Success = false,
                ErrorMessage = adapterName != null 
                    ? $"WiFi adapter '{adapterName}' not found"
                    : "No WiFi adapters found",
                Platform = "Linux"
            };
        }

        var networks = new List<WifiNetwork>();
        string? errorMessage = null;

        // Try nmcli first (more reliable, doesn't require root)
        var nmcliResult = await ScanWithNmcliAsync(adapter.Name, ct);
        if (nmcliResult.Success)
        {
            networks = nmcliResult.Networks;
        }
        else
        {
            // Fall back to iwlist (may require root)
            var iwlistResult = await ScanWithIwlistAsync(adapter.Name, ct);
            if (iwlistResult.Success)
            {
                networks = iwlistResult.Networks;
            }
            else
            {
                errorMessage = $"nmcli: {nmcliResult.ErrorMessage}; iwlist: {iwlistResult.ErrorMessage}";
            }
        }

        return new WifiScanResult
        {
            Adapter = adapter,
            Networks = networks.OrderByDescending(n => n.SignalQualityPercent ?? 0).ToList(),
            StartedAt = startedAt,
            CompletedAt = DateTime.UtcNow,
            Success = errorMessage == null,
            ErrorMessage = errorMessage,
            Platform = "Linux"
        };
    }

    private async Task<(bool Success, List<WifiNetwork> Networks, string? ErrorMessage)> ScanWithNmcliAsync(
        string interfaceName, 
        CancellationToken ct)
    {
        var networks = new List<WifiNetwork>();

        try
        {
            // Trigger a rescan first
            await RunCommandAsync("nmcli", $"device wifi rescan ifname {interfaceName}", ct);
            await Task.Delay(2000, ct); // Wait for scan to complete

            // Get networks with detailed info
            var output = await RunCommandAsync(
                "nmcli", 
                $"-t -f SSID,BSSID,MODE,CHAN,FREQ,RATE,SIGNAL,BARS,SECURITY,IN-USE device wifi list ifname {interfaceName}",
                ct);

            if (string.IsNullOrEmpty(output))
            {
                return (false, networks, "nmcli returned no output");
            }

            foreach (var line in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
            {
                var parts = line.Split(':');
                if (parts.Length >= 9)
                {
                    var ssid = parts[0];
                    if (string.IsNullOrWhiteSpace(ssid))
                    {
                        ssid = "[Hidden Network]";
                    }

                    var bssid = parts[1].Replace("\\:", ":"); // nmcli escapes colons
                    var mode = parts[2];
                    int.TryParse(parts[3], out var channel);
                    
                    // Parse frequency (e.g., "2437 MHz")
                    var freqMatch = FrequencyRegex().Match(parts[4]);
                    int.TryParse(freqMatch.Groups[1].Value, out var frequency);
                    
                    int.TryParse(parts[6], out var signal);
                    var security = parts[8].Split(' ', StringSplitOptions.RemoveEmptyEntries).ToList();
                    var inUse = parts.Length > 9 && parts[9] == "*";

                    networks.Add(new WifiNetwork
                    {
                        Ssid = ssid,
                        Bssid = bssid.ToUpperInvariant(),
                        NetworkType = mode,
                        Channel = channel,
                        FrequencyMhz = frequency,
                        Band = WifiHelpers.GetBand(frequency),
                        SignalQualityPercent = signal,
                        SignalStrengthDbm = WifiHelpers.PercentToDbm(signal),
                        Security = security.Count > 0 ? security : ["Open"],
                        IsSecured = security.Count > 0 && !security.Contains("--"),
                        IsConnected = inUse,
                        DiscoveredAt = DateTime.UtcNow
                    });
                }
            }

            return (true, networks, null);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "nmcli scan failed");
            return (false, networks, ex.Message);
        }
    }

    private async Task<(bool Success, List<WifiNetwork> Networks, string? ErrorMessage)> ScanWithIwlistAsync(
        string interfaceName, 
        CancellationToken ct)
    {
        var networks = new List<WifiNetwork>();

        try
        {
            var output = await RunCommandAsync("iwlist", $"{interfaceName} scan", ct);

            if (string.IsNullOrEmpty(output))
            {
                return (false, networks, "iwlist returned no output (may require root)");
            }

            // Parse iwlist output
            WifiNetwork? current = null;
            var security = new List<string>();

            foreach (var line in output.Split('\n'))
            {
                var trimmed = line.Trim();

                // New cell (network)
                if (trimmed.StartsWith("Cell ") && trimmed.Contains("Address:"))
                {
                    if (current != null)
                    {
                        current = current with { Security = security.Count > 0 ? security : ["Open"] };
                        networks.Add(current);
                    }

                    var bssidMatch = BssidRegex().Match(trimmed);
                    current = new WifiNetwork
                    {
                        Ssid = "", // Will be filled later
                        Bssid = bssidMatch.Success ? bssidMatch.Groups[1].Value : null,
                        DiscoveredAt = DateTime.UtcNow
                    };
                    security = [];
                }
                else if (current != null)
                {
                    // SSID
                    if (trimmed.StartsWith("ESSID:"))
                    {
                        var ssid = trimmed[6..].Trim('"');
                        current = current with { Ssid = string.IsNullOrEmpty(ssid) ? "[Hidden Network]" : ssid };
                    }
                    // Frequency
                    else if (trimmed.StartsWith("Frequency:"))
                    {
                        var freqMatch = FrequencyGhzRegex().Match(trimmed);
                        if (freqMatch.Success && double.TryParse(freqMatch.Groups[1].Value, out var freqGhz))
                        {
                            var freqMhz = (int)(freqGhz * 1000);
                            current = current with
                            {
                                FrequencyMhz = freqMhz,
                                Channel = WifiHelpers.FrequencyToChannel(freqMhz),
                                Band = WifiHelpers.GetBand(freqMhz)
                            };
                        }

                        var chanMatch = ChannelRegex().Match(trimmed);
                        if (chanMatch.Success && int.TryParse(chanMatch.Groups[1].Value, out var channel))
                        {
                            current = current with { Channel = channel };
                        }
                    }
                    // Signal level
                    else if (trimmed.Contains("Signal level"))
                    {
                        var signalMatch = SignalDbmRegex().Match(trimmed);
                        if (signalMatch.Success && int.TryParse(signalMatch.Groups[1].Value, out var dbm))
                        {
                            current = current with
                            {
                                SignalStrengthDbm = dbm,
                                SignalQualityPercent = WifiHelpers.DbmToPercent(dbm)
                            };
                        }

                        var qualityMatch = QualityRegex().Match(trimmed);
                        if (qualityMatch.Success)
                        {
                            if (int.TryParse(qualityMatch.Groups[1].Value, out var qual) &&
                                int.TryParse(qualityMatch.Groups[2].Value, out var maxQual) &&
                                maxQual > 0)
                            {
                                current = current with { SignalQualityPercent = (qual * 100) / maxQual };
                            }
                        }
                    }
                    // Encryption
                    else if (trimmed.StartsWith("Encryption key:"))
                    {
                        var encrypted = trimmed.Contains("on", StringComparison.OrdinalIgnoreCase);
                        current = current with { IsSecured = encrypted };
                        if (!encrypted)
                        {
                            security.Add("Open");
                        }
                    }
                    // WPA/WPA2
                    else if (trimmed.Contains("WPA2"))
                    {
                        if (!security.Contains("WPA2"))
                            security.Add("WPA2");
                    }
                    else if (trimmed.Contains("WPA"))
                    {
                        if (!security.Contains("WPA") && !security.Contains("WPA2"))
                            security.Add("WPA");
                    }
                    // Mode
                    else if (trimmed.StartsWith("Mode:"))
                    {
                        current = current with { NetworkType = trimmed[5..].Trim() };
                    }
                }
            }

            // Add last network
            if (current != null)
            {
                current = current with { Security = security.Count > 0 ? security : ["Open"] };
                networks.Add(current);
            }

            return (true, networks, null);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "iwlist scan failed");
            return (false, networks, ex.Message);
        }
    }

    private static async Task<string> RunCommandAsync(string command, string arguments, CancellationToken ct)
    {
        try
        {
            using var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = command,
                Arguments = arguments,
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);
            
            return output;
        }
        catch
        {
            return string.Empty;
        }
    }

    [GeneratedRegex(@"(\d+)\s*MHz")]
    private static partial Regex FrequencyRegex();

    [GeneratedRegex(@"Address:\s*([0-9A-Fa-f:]+)")]
    private static partial Regex BssidRegex();

    [GeneratedRegex(@"(\d+\.?\d*)\s*GHz")]
    private static partial Regex FrequencyGhzRegex();

    [GeneratedRegex(@"Channel\s*(\d+)")]
    private static partial Regex ChannelRegex();

    [GeneratedRegex(@"Signal level[=:]\s*(-?\d+)\s*dBm")]
    private static partial Regex SignalDbmRegex();

    [GeneratedRegex(@"Quality[=:]\s*(\d+)/(\d+)")]
    private static partial Regex QualityRegex();
}
