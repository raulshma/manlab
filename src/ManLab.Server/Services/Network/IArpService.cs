using System.Net;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Service interface for ARP (Address Resolution Protocol) operations.
/// </summary>
public interface IArpService
{
    /// <summary>
    /// Gets the MAC address for an IP address via ARP lookup.
    /// </summary>
    /// <param name="ip">The IP address to look up.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>The MAC address in format XX:XX:XX:XX:XX:XX, or null if not found.</returns>
    Task<string?> GetMacAddressAsync(IPAddress ip, CancellationToken ct = default);
    
    /// <summary>
    /// Gets the current ARP table.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Dictionary mapping IP addresses to MAC addresses.</returns>
    Task<IReadOnlyDictionary<string, string>> GetArpTableAsync(CancellationToken ct = default);
}
