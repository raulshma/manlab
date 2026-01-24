using System.Diagnostics;
using System.Net;
using System.Runtime.InteropServices;
using System.Runtime.Versioning;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Windows implementation of ARP service using iphlpapi.dll P/Invoke.
/// </summary>
[SupportedOSPlatform("windows")]
public sealed class WindowsArpService : IArpService
{
    private readonly ILogger<WindowsArpService> _logger;

    [DllImport("iphlpapi.dll", ExactSpelling = true)]
    private static extern int SendARP(int destIp, int srcIp, byte[] macAddr, ref uint macAddrLen);

    public WindowsArpService(ILogger<WindowsArpService> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<string?> GetMacAddressAsync(IPAddress ip, CancellationToken ct = default)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("This method is only supported on Windows");
        }

        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
        {
            _logger.LogWarning("Only IPv4 addresses are supported for ARP lookup");
            return null;
        }

        return await Task.Run(() =>
        {
            try
            {
                var macAddr = new byte[6];
                uint macAddrLen = (uint)macAddr.Length;
                int destIp = BitConverter.ToInt32(ip.GetAddressBytes(), 0);

                int result = SendARP(destIp, 0, macAddr, ref macAddrLen);
                if (result == 0)
                {
                    return FormatMacAddress(macAddr);
                }

                _logger.LogDebug("SendARP failed for {IP} with error code {ErrorCode}", ip, result);
                return null;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to get MAC address for {IP}", ip);
                return null;
            }
        }, ct);
    }

    /// <inheritdoc />
    public async Task<IReadOnlyDictionary<string, string>> GetArpTableAsync(CancellationToken ct = default)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("This method is only supported on Windows");
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
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("This method is only supported on Windows");
        }

        try
        {
            var result = await RunCommandAsync("arp", "-a", ct);
            if (result.ExitCode != 0)
            {
                _logger.LogWarning("ARP command returned exit code {ExitCode}: {Error}", result.ExitCode, result.Error);
            }

            return ParseArpOutput(result.Output);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get ARP table");
            return Array.Empty<ArpTableEntry>();
        }
    }

    /// <inheritdoc />
    public async Task<ArpOperationResult> AddStaticEntryAsync(IPAddress ip, string macAddress, string? interfaceName = null, CancellationToken ct = default)
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("This method is only supported on Windows");
        }

        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
        {
            return new ArpOperationResult
            {
                Success = false,
                Error = "Only IPv4 addresses are supported for ARP operations"
            };
        }

        var args = string.IsNullOrWhiteSpace(interfaceName)
            ? $"-s {ip} {macAddress}"
            : $"-s {ip} {macAddress} {interfaceName}";

        var result = await RunCommandAsync("arp", args, ct);
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
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("This method is only supported on Windows");
        }

        if (ip.AddressFamily != System.Net.Sockets.AddressFamily.InterNetwork)
        {
            return new ArpOperationResult
            {
                Success = false,
                Error = "Only IPv4 addresses are supported for ARP operations"
            };
        }

        var result = await RunCommandAsync("arp", $"-d {ip}", ct);
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
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("This method is only supported on Windows");
        }

        var result = await RunCommandAsync("arp", "-d *", ct);
        return new ArpOperationResult
        {
            Success = result.ExitCode == 0,
            Error = result.ExitCode == 0 ? null : result.Error,
            Output = result.Output
        };
    }

    private static string FormatMacAddress(byte[] mac)
    {
        return string.Join(":", mac.Select(b => b.ToString("X2")));
    }

    private static bool IsValidMac(string mac)
    {
        // Check it's not all zeros and has correct format
        return mac.Replace(":", "").Length == 12 && mac != "00:00:00:00:00:00";
    }

    private static IReadOnlyList<ArpTableEntry> ParseArpOutput(string output)
    {
        var entries = new List<ArpTableEntry>();
        string? currentInterface = null;

        foreach (var rawLine in output.Split('\n', StringSplitOptions.RemoveEmptyEntries))
        {
            var line = rawLine.Trim();
            if (string.IsNullOrWhiteSpace(line))
            {
                continue;
            }

            if (line.StartsWith("Interface:", StringComparison.OrdinalIgnoreCase))
            {
                var parts = line.Split("---", StringSplitOptions.RemoveEmptyEntries);
                currentInterface = parts[0].Replace("Interface:", string.Empty, StringComparison.OrdinalIgnoreCase).Trim();
                continue;
            }

            if (line.StartsWith("Internet Address", StringComparison.OrdinalIgnoreCase))
            {
                continue;
            }

            var partsLine = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            if (partsLine.Length < 2)
            {
                continue;
            }

            if (!IPAddress.TryParse(partsLine[0], out _))
            {
                continue;
            }

            var mac = partsLine[1].Replace("-", ":").ToUpperInvariant();
            if (!IsValidMac(mac))
            {
                continue;
            }

            bool? isStatic = null;
            if (partsLine.Length >= 3)
            {
                if (string.Equals(partsLine[2], "static", StringComparison.OrdinalIgnoreCase))
                {
                    isStatic = true;
                }
                else if (string.Equals(partsLine[2], "dynamic", StringComparison.OrdinalIgnoreCase))
                {
                    isStatic = false;
                }
            }

            entries.Add(new ArpTableEntry
            {
                IpAddress = partsLine[0],
                MacAddress = mac,
                InterfaceName = currentInterface,
                IsStatic = isStatic
            });
        }

        return entries;
    }

    private static async Task<CommandResult> RunCommandAsync(string fileName, string arguments, CancellationToken ct)
    {
        try
        {
            using var process = new Process();
            process.StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
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
