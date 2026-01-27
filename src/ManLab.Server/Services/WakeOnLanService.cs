using System.Net;
using System.Net.Sockets;

namespace ManLab.Server.Services;

/// <summary>
/// Service for sending Wake-on-LAN magic packets to restart offline nodes.
/// </summary>
public interface IWakeOnLanService
{
    /// <summary>
    /// Sends a Wake-on-LAN magic packet to the specified MAC address.
    /// </summary>
    /// <param name="macAddress">MAC address formatted as XX:XX:XX:XX:XX:XX.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>True if the packet was sent successfully, false otherwise.</returns>
    Task<bool> SendWakeAsync(string macAddress, CancellationToken ct = default);
}

/// <summary>
/// Implementation of Wake-on-LAN service that sends UDP magic packets.
/// </summary>
public sealed class WakeOnLanService : IWakeOnLanService
{
    private readonly ILogger<WakeOnLanService> _logger;

    // WoL uses UDP port 9 for the magic packet
    private const int WolPort = 9;

    public WakeOnLanService(ILogger<WakeOnLanService> logger)
    {
        _logger = logger;
    }

    /// <inheritdoc />
    public async Task<bool> SendWakeAsync(string macAddress, CancellationToken ct = default)
    {
        if (string.IsNullOrWhiteSpace(macAddress))
        {
            _logger.LogWarning("Cannot send WoL packet: MAC address is null or empty");
            return false;
        }

        try
        {
            var macBytes = ParseMacAddress(macAddress);
            if (macBytes is null)
            {
                _logger.LogWarning("Cannot send WoL packet: Invalid MAC address format '{MacAddress}'", macAddress);
                return false;
            }

            var magicPacket = BuildMagicPacket(macBytes);

            using var udpClient = new UdpClient();
            udpClient.EnableBroadcast = true;

            // Send to the broadcast address on the standard WoL port
            var broadcastEndpoint = new IPEndPoint(IPAddress.Broadcast, WolPort);

            await udpClient.SendAsync(magicPacket, magicPacket.Length, broadcastEndpoint)
                .ConfigureAwait(false);

            _logger.LogInformation("Wake-on-LAN packet sent to {MacAddress}", macAddress);
            return true;
        }
        catch (SocketException ex)
        {
            _logger.LogError(ex, "Socket error sending WoL packet to {MacAddress}", macAddress);
            return false;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to send WoL packet to {MacAddress}", macAddress);
            return false;
        }
    }

    /// <summary>
    /// Parses a MAC address string (XX:XX:XX:XX:XX:XX or XX-XX-XX-XX-XX-XX) to bytes.
    /// </summary>
    private static byte[]? ParseMacAddress(string macAddress)
    {
        // Normalize separators
        var normalized = macAddress.Replace("-", ":").Replace(".", ":").ToUpperInvariant();
        var parts = normalized.Split(':');

        if (parts.Length != 6)
        {
            return null;
        }

        var bytes = new byte[6];
        for (int i = 0; i < 6; i++)
        {
            if (!byte.TryParse(parts[i], System.Globalization.NumberStyles.HexNumber, null, out bytes[i]))
            {
                return null;
            }
        }

        return bytes;
    }

    /// <summary>
    /// Builds a Wake-on-LAN magic packet.
    /// Format: 6 bytes of 0xFF followed by 16 repetitions of the MAC address.
    /// </summary>
    private static byte[] BuildMagicPacket(byte[] macBytes)
    {
        // Magic packet: 6 bytes of 0xFF + 16 * 6 bytes of MAC address = 102 bytes
        var packet = new byte[6 + (16 * 6)];

        // Fill first 6 bytes with 0xFF
        for (int i = 0; i < 6; i++)
        {
            packet[i] = 0xFF;
        }

        // Repeat MAC address 16 times
        for (int i = 0; i < 16; i++)
        {
            Array.Copy(macBytes, 0, packet, 6 + (i * 6), 6);
        }

        return packet;
    }
}
