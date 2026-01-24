using System.Diagnostics;
using System.Globalization;
using System.Net;
using System.Runtime.Versioning;
using System.Text.RegularExpressions;

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

        var entries = await GetArpEntriesAsync(ct);
        var result = new Dictionary<string, string>();
        foreach (var entry in entries)
        {
            result[entry.IpAddress] = entry.MacAddress;
        }

        return result;
    }

    /// <inheritdoc />
    public async Task<IReadOnlyList<ArpTableEntry>> GetArpEntriesAsync(CancellationToken ct = default)
    {
        if (!OperatingSystem.IsLinux())
        {
            throw new PlatformNotSupportedException("This method is only supported on Linux");
        }

        var result = new List<ArpTableEntry>();

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
                if (parts.Length >= 6)
                {
                    var ipAddress = parts[0];
                    var flags = parts[2];
                    var mac = parts[3].ToUpperInvariant();
                    var device = parts[5];

                    if (mac != "00:00:00:00:00:00" && IPAddress.TryParse(ipAddress, out _))
                    {
                        result.Add(new ArpTableEntry
                        {
                            IpAddress = ipAddress,
                            MacAddress = mac,
                            InterfaceName = device,
                            IsStatic = ParseFlagsIsStatic(flags)
                        });
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

    /// <inheritdoc />
    public async Task<ArpOperationResult> AddStaticEntryAsync(IPAddress ip, string macAddress, string? interfaceName = null, CancellationToken ct = default)
    {
        if (!OperatingSystem.IsLinux())
        {
            throw new PlatformNotSupportedException("This method is only supported on Linux");
        }

        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
        {
            return new ArpOperationResult
            {
                Success = false,
                Error = "Only IPv4 addresses are supported for ARP operations"
            };
        }

        var iface = string.IsNullOrWhiteSpace(interfaceName)
            ? await TryResolveInterfaceAsync(ip, ct)
            : interfaceName;

        CommandResult result;
        if (!string.IsNullOrWhiteSpace(iface))
        {
            result = await RunCommandAsync("ip", $"neigh replace {ip} lladdr {macAddress} nud permanent dev {iface}", ct);
        }
        else
        {
            result = await RunCommandAsync("arp", $"-s {ip} {macAddress}", ct);
        }

        return new ArpOperationResult
        {
            Success = result.ExitCode == 0,
            Error = result.ExitCode == 0 ? null : result.Error,
            Output = result.Output
        };
    }

    /// <inheritdoc />
    public async Task<ArpOperationResult> RemoveEntryAsync(IPAddress ip, CancellationToken ct = default)
    {
        if (!OperatingSystem.IsLinux())
        {
            throw new PlatformNotSupportedException("This method is only supported on Linux");
        }

        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
        {
            return new ArpOperationResult
            {
                Success = false,
                Error = "Only IPv4 addresses are supported for ARP operations"
            };
        }

        var iface = await TryResolveInterfaceAsync(ip, ct);
        CommandResult result;

        if (!string.IsNullOrWhiteSpace(iface))
        {
            result = await RunCommandAsync("ip", $"neigh del {ip} dev {iface}", ct);
        }
        else
        {
            result = await RunCommandAsync("ip", $"neigh del {ip}", ct);
            if (result.ExitCode != 0)
            {
                result = await RunCommandAsync("arp", $"-d {ip}", ct);
            }
        }

        return new ArpOperationResult
        {
            Success = result.ExitCode == 0,
            Error = result.ExitCode == 0 ? null : result.Error,
            Output = result.Output
        };
    }

    /// <inheritdoc />
    public async Task<ArpOperationResult> FlushAsync(CancellationToken ct = default)
    {
        if (!OperatingSystem.IsLinux())
        {
            throw new PlatformNotSupportedException("This method is only supported on Linux");
        }

        var result = await RunCommandAsync("ip", "-s -s neigh flush all", ct);
        return new ArpOperationResult
        {
            Success = result.ExitCode == 0,
            Error = result.ExitCode == 0 ? null : result.Error,
            Output = result.Output
        };
    }

    private static bool? ParseFlagsIsStatic(string flags)
    {
        if (string.IsNullOrWhiteSpace(flags))
        {
            return null;
        }

        var cleaned = flags.StartsWith("0x", StringComparison.OrdinalIgnoreCase)
            ? flags[2..]
            : flags;

        if (!int.TryParse(cleaned, NumberStyles.HexNumber, CultureInfo.InvariantCulture, out var value))
        {
            return null;
        }

        const int PermanentFlag = 0x4;
        const int CompletedFlag = 0x2;

        if ((value & PermanentFlag) != 0)
        {
            return true;
        }

        if ((value & CompletedFlag) != 0)
        {
            return false;
        }

        return null;
    }

    private static async Task<string?> TryResolveInterfaceAsync(IPAddress ip, CancellationToken ct)
    {
        var result = await RunCommandAsync("ip", $"route get {ip}", ct);
        if (result.ExitCode != 0)
        {
            return null;
        }

        var match = Regex.Match(result.Output, "\\bdev\\s+(\\S+)", RegexOptions.IgnoreCase);
        return match.Success ? match.Groups[1].Value : null;
    }

    private static async Task<CommandResult> RunCommandAsync(string command, string arguments, CancellationToken ct)
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
            var error = await process.StandardError.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);

            return new CommandResult(process.ExitCode, output.Trim(), error.Trim());
        }
        catch (Exception ex)
        {
            return new CommandResult(1, string.Empty, ex.Message);
        }
    }

    private sealed record CommandResult(int ExitCode, string Output, string Error);
}
