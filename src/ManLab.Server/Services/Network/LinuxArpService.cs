using System.Net;
using System.Runtime.Versioning;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Linux implementation of ARP service using /proc/net/arp.
/// </summary>
[SupportedOSPlatform("linux")]
public sealed class LinuxArpService : IArpService
{
    private readonly ILogger<LinuxArpService> _logger;
    private const string ArpFilePath = "/proc/net/arp";

    public LinuxArpService(ILogger<LinuxArpService> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<string?> GetMacAddressAsync(IPAddress ip, CancellationToken ct = default)
    {
        if (!OperatingSystem.IsLinux())
        {
            throw new PlatformNotSupportedException("This method is only supported on Linux");
        }

        var arpTable = await GetArpTableAsync(ct);
        return arpTable.GetValueOrDefault(ip.ToString());
    }

    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<string, string>> GetArpTableAsync(CancellationToken ct = default)
    {
        if (!OperatingSystem.IsLinux())
        {
            throw new PlatformNotSupportedException("This method is only supported on Linux");
        }

        var result = new Dictionary<string, string>();

        try
        {
            if (!File.Exists(ArpFilePath))
            {
                _logger.LogWarning("ARP file not found at {Path}", ArpFilePath);
                return result;
            }

            var lines = await File.ReadAllLinesAsync(ArpFilePath, ct);

            // Skip header line: "IP address       HW type     Flags       HW address            Mask     Device"
            foreach (var line in lines.Skip(1))
            {
                ct.ThrowIfCancellationRequested();

                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 4)
                {
                    var ipAddress = parts[0];
                    var mac = parts[3].ToUpperInvariant();

                    // Skip incomplete entries (all zeros)
                    if (mac != "00:00:00:00:00:00" && IPAddress.TryParse(ipAddress, out _))
                    {
                        result[ipAddress] = mac;
                    }
                }
            }
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read ARP table from {Path}", ArpFilePath);
        }

        return result;
    }
}
