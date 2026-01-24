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

    /// <summary>
    /// Gets the current ARP table with detailed entries.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>List of ARP table entries.</returns>
    Task<IReadOnlyList<ArpTableEntry>> GetArpEntriesAsync(CancellationToken ct = default);

    /// <summary>
    /// Adds or replaces a static ARP entry.
    /// </summary>
    /// <param name="ip">IP address to map.</param>
    /// <param name="macAddress">MAC address for the entry.</param>
    /// <param name="interfaceName">Optional interface/device name.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Operation result.</returns>
    Task<ArpOperationResult> AddStaticEntryAsync(IPAddress ip, string macAddress, string? interfaceName = null, CancellationToken ct = default);

    /// <summary>
    /// Removes an ARP entry.
    /// </summary>
    /// <param name="ip">IP address to remove.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Operation result.</returns>
    Task<ArpOperationResult> RemoveEntryAsync(IPAddress ip, CancellationToken ct = default);

    /// <summary>
    /// Flushes the ARP cache.
    /// </summary>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Operation result.</returns>
    Task<ArpOperationResult> FlushAsync(CancellationToken ct = default);
}
