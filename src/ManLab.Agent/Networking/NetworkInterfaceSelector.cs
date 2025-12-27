using System.Net;
using System.Net.NetworkInformation;
using Microsoft.Extensions.Logging;

namespace ManLab.Agent.Networking;

internal static class NetworkInterfaceSelector
{
    public static string? SelectPrimaryInterfaceName(string? configuredName, ILogger? logger = null)
    {
        configuredName = configuredName?.Trim();
        if (!string.IsNullOrWhiteSpace(configuredName))
        {
            return configuredName;
        }

        try
        {
            var candidates = NetworkInterface.GetAllNetworkInterfaces()
                .Where(nic => nic.OperationalStatus == OperationalStatus.Up)
                .Where(nic => nic.NetworkInterfaceType != NetworkInterfaceType.Loopback)
                .Where(nic => nic.NetworkInterfaceType != NetworkInterfaceType.Tunnel)
                .Select(nic => new { Nic = nic, Props = nic.GetIPProperties() })
                .Where(x => x.Props.UnicastAddresses.Any(a => a.Address.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork))
                .ToList();

            var withGateway = candidates
                .FirstOrDefault(x => x.Props.GatewayAddresses.Any(g => g.Address is not null && !g.Address.Equals(IPAddress.Any) && !g.Address.Equals(IPAddress.None)));

            return (withGateway ?? candidates.FirstOrDefault())?.Nic.Name;
        }
        catch (Exception ex)
        {
            logger?.LogDebug(ex, "Failed to auto-detect primary network interface");
            return null;
        }
    }

    public static NetworkInterface? TryGetInterfaceByName(string? name)
    {
        name = name?.Trim();
        if (string.IsNullOrWhiteSpace(name))
        {
            return null;
        }

        try
        {
            return NetworkInterface.GetAllNetworkInterfaces()
                .FirstOrDefault(nic => string.Equals(nic.Name, name, StringComparison.OrdinalIgnoreCase));
        }
        catch
        {
            return null;
        }
    }

    public static string? TryGetDefaultGatewayIpv4(NetworkInterface nic)
    {
        try
        {
            var props = nic.GetIPProperties();
            var gw = props.GatewayAddresses
                .Select(g => g.Address)
                .FirstOrDefault(a => a is not null && a.AddressFamily == System.Net.Sockets.AddressFamily.InterNetwork && !a.Equals(IPAddress.Any) && !a.Equals(IPAddress.None));

            return gw?.ToString();
        }
        catch
        {
            return null;
        }
    }

    public static bool TryGetIpv4ByteCounters(NetworkInterface nic, out long rxBytes, out long txBytes)
    {
        rxBytes = 0;
        txBytes = 0;

        try
        {
            var stats = nic.GetIPv4Statistics();
            rxBytes = stats.BytesReceived;
            txBytes = stats.BytesSent;
            return true;
        }
        catch
        {
            return false;
        }
    }
}
