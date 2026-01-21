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

        // For Windows, we use the 'arp -a' command as there's no simple P/Invoke for enumerating the full table
        var result = new Dictionary<string, string>();

        try
        {
            using var process = new System.Diagnostics.Process();
            process.StartInfo = new System.Diagnostics.ProcessStartInfo
            {
                FileName = "arp",
                Arguments = "-a",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                CreateNoWindow = true
            };

            process.Start();
            var output = await process.StandardOutput.ReadToEndAsync(ct);
            await process.WaitForExitAsync(ct);

            // Parse output: "  192.168.1.1          aa-bb-cc-dd-ee-ff     dynamic"
            foreach (var line in output.Split('\n'))
            {
                var parts = line.Split(' ', StringSplitOptions.RemoveEmptyEntries);
                if (parts.Length >= 2)
                {
                    if (IPAddress.TryParse(parts[0], out _))
                    {
                        var mac = parts[1].Replace("-", ":").ToUpperInvariant();
                        if (IsValidMac(mac))
                        {
                            result[parts[0]] = mac;
                        }
                    }
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to get ARP table");
        }

        return result;
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
}
