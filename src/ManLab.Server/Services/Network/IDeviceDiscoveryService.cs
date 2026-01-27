namespace ManLab.Server.Services.Network;

/// <summary>
/// Service interface for mDNS and UPnP device discovery.
/// </summary>
public interface IDeviceDiscoveryService
{
    /// <summary>
    /// Discovers devices on the local network using both mDNS and UPnP/SSDP.
    /// </summary>
    /// <param name="scanDurationSeconds">How long to listen for device announcements (default: 5 seconds).</param>
    /// <param name="onMdnsDeviceFound">Optional callback invoked when an mDNS device is found.</param>
    /// <param name="onUpnpDeviceFound">Optional callback invoked when a UPnP device is found.</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>Discovery scan result containing all discovered devices.</returns>
    Task<DiscoveryScanResult> DiscoverAllAsync(
        int scanDurationSeconds = 5,
        Func<MdnsDiscoveredDevice, Task>? onMdnsDeviceFound = null,
        Func<UpnpDiscoveredDevice, Task>? onUpnpDeviceFound = null,
        CancellationToken ct = default);

    /// <summary>
    /// Discovers devices via mDNS (Multicast DNS / Bonjour / Avahi).
    /// </summary>
    /// <param name="serviceTypes">Service types to search for (null for common types).</param>
    /// <param name="scanDurationSeconds">How long to listen for device announcements (default: 5 seconds).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>List of discovered mDNS devices.</returns>
    Task<List<MdnsDiscoveredDevice>> DiscoverMdnsAsync(
        string[]? serviceTypes = null,
        int scanDurationSeconds = 5,
        CancellationToken ct = default);

    /// <summary>
    /// Discovers devices via UPnP/SSDP (Simple Service Discovery Protocol).
    /// </summary>
    /// <param name="searchTarget">The SSDP search target (default: "ssdp:all").</param>
    /// <param name="scanDurationSeconds">How long to listen for device responses (default: 5 seconds).</param>
    /// <param name="ct">Cancellation token.</param>
    /// <returns>List of discovered UPnP devices.</returns>
    Task<List<UpnpDiscoveredDevice>> DiscoverUpnpAsync(
        string? searchTarget = null,
        int scanDurationSeconds = 5,
        CancellationToken ct = default);
}
