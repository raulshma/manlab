using Rssdp;
using System.Collections.Concurrent;
using System.Net;
using System.Xml.Linq;
using Tmds.MDns;

namespace ManLab.Server.Services.Network;

/// <summary>
/// Implementation of device discovery using mDNS and UPnP/SSDP protocols.
/// </summary>
public sealed class DeviceDiscoveryService : IDeviceDiscoveryService
{
    private readonly ILogger<DeviceDiscoveryService> _logger;
    private readonly HttpClient _httpClient;

    public DeviceDiscoveryService(
        ILogger<DeviceDiscoveryService> logger,
        IHttpClientFactory httpClientFactory)
    {
        _logger = logger;
        _httpClient = httpClientFactory.CreateClient();
        _httpClient.Timeout = TimeSpan.FromSeconds(5);
    }

    /// <inheritdoc />
    public async Task<DiscoveryScanResult> DiscoverAllAsync(
        int scanDurationSeconds = 5,
        Func<MdnsDiscoveredDevice, Task>? onMdnsDeviceFound = null,
        Func<UpnpDiscoveredDevice, Task>? onUpnpDeviceFound = null,
        CancellationToken ct = default)
    {
        scanDurationSeconds = Math.Clamp(scanDurationSeconds, 1, 30);
        var startedAt = DateTime.UtcNow;

        _logger.LogInformation("Starting combined mDNS/UPnP discovery scan for {Duration}s", scanDurationSeconds);

        // Run both discovery methods in parallel
        var mdnsTask = DiscoverMdnsInternalAsync(null, scanDurationSeconds, onMdnsDeviceFound, ct);
        var upnpTask = DiscoverUpnpInternalAsync(null, scanDurationSeconds, onUpnpDeviceFound, ct);

        await Task.WhenAll(mdnsTask, upnpTask);

        var result = new DiscoveryScanResult
        {
            MdnsDevices = await mdnsTask,
            UpnpDevices = await upnpTask,
            StartedAt = startedAt,
            CompletedAt = DateTime.UtcNow
        };

        _logger.LogInformation(
            "Discovery scan completed: {MdnsCount} mDNS devices, {UpnpCount} UPnP devices",
            result.MdnsDevices.Count,
            result.UpnpDevices.Count);

        return result;
    }

    /// <inheritdoc />
    public Task<List<MdnsDiscoveredDevice>> DiscoverMdnsAsync(
        string[]? serviceTypes = null,
        int scanDurationSeconds = 5,
        CancellationToken ct = default)
        => DiscoverMdnsInternalAsync(serviceTypes, scanDurationSeconds, onDeviceFound: null, ct);

    private async Task<List<MdnsDiscoveredDevice>> DiscoverMdnsInternalAsync(
        string[]? serviceTypes,
        int scanDurationSeconds,
        Func<MdnsDiscoveredDevice, Task>? onDeviceFound,
        CancellationToken ct)
    {
        scanDurationSeconds = Math.Clamp(scanDurationSeconds, 1, 30);
        serviceTypes ??= MdnsServiceTypes.CommonTypes;

        var discovered = new ConcurrentDictionary<string, MdnsDiscoveredDevice>();

        _logger.LogDebug("Starting mDNS discovery for {Count} service types", serviceTypes.Length);

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(scanDurationSeconds));

            var browsers = new List<ServiceBrowser>();

            // Track which service types we've already started browsing to avoid duplicates
            var browsedTypes = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            // Handler for discovered services
            void HandleServiceAdded(object? sender, ServiceAnnouncementEventArgs e)
            {
                try
                {
                    var key = $"{e.Announcement.Hostname}:{e.Announcement.Port}:{e.Announcement.Type}";

                    var device = new MdnsDiscoveredDevice
                    {
                        Name = e.Announcement.Instance,
                        ServiceType = e.Announcement.Type,
                        Hostname = e.Announcement.Hostname,
                        IpAddresses = e.Announcement.Addresses?.Select(a => a.ToString()).ToList() ?? [],
                        Port = e.Announcement.Port,
                        TxtRecords = e.Announcement.Txt?.ToDictionary(t =>
                            t.Contains('=') ? t.Split('=')[0] : t,
                            t => t.Contains('=') ? t.Split('=', 2)[1] : string.Empty) ?? [],
                        NetworkInterface = e.Announcement.NetworkInterface?.Name,
                        DiscoveredAt = DateTime.UtcNow
                    };

                    if (discovered.TryAdd(key, device))
                    {
                        _ = SafeInvokeAsync(onDeviceFound, device, "mDNS device");
                    }

                    _logger.LogDebug(
                        "mDNS: Discovered {Name} ({Type}) at {Host}:{Port}",
                        device.Name,
                        device.ServiceType,
                        device.Hostname,
                        device.Port);
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Error processing mDNS service announcement");
                }
            }

            // Create service browser for each predefined service type
            foreach (var serviceType in serviceTypes)
            {
                if (!browsedTypes.Add(serviceType))
                    continue;

                var browser = new ServiceBrowser();
                browser.ServiceAdded += HandleServiceAdded;
                browser.StartBrowse(serviceType);
                browsers.Add(browser);
            }

            // Wait for scan duration
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(scanDurationSeconds), cts.Token);
            }
            catch (OperationCanceledException)
            {
                // Expected when duration expires or caller cancels
            }

            // Cleanup all browsers
            foreach (var browser in browsers)
            {
                try
                {
                    browser.StopBrowse();
                }
                catch
                {
                    // Ignore cleanup errors
                }
            }
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Error during mDNS discovery");
        }

        _logger.LogDebug("mDNS discovery completed: {Count} devices found", discovered.Count);
        return discovered.Values.ToList();
    }

    /// <inheritdoc />
    public Task<List<UpnpDiscoveredDevice>> DiscoverUpnpAsync(
        string? searchTarget = null,
        int scanDurationSeconds = 5,
        CancellationToken ct = default)
        => DiscoverUpnpInternalAsync(searchTarget, scanDurationSeconds, onDeviceFound: null, ct);

    private async Task<List<UpnpDiscoveredDevice>> DiscoverUpnpInternalAsync(
        string? searchTarget,
        int scanDurationSeconds,
        Func<UpnpDiscoveredDevice, Task>? onDeviceFound,
        CancellationToken ct)
    {
        scanDurationSeconds = Math.Clamp(scanDurationSeconds, 1, 30);
        searchTarget ??= "ssdp:all";

        var discovered = new ConcurrentDictionary<string, UpnpDiscoveredDevice>();

        _logger.LogDebug("Starting UPnP/SSDP discovery for target: {Target}", searchTarget);

        try
        {
            using var cts = CancellationTokenSource.CreateLinkedTokenSource(ct);
            cts.CancelAfter(TimeSpan.FromSeconds(scanDurationSeconds));

            using var locator = new SsdpDeviceLocator();

            // Handle device discovery events
            locator.DeviceAvailable += async (s, e) =>
            {
                try
                {
                    var device = await CreateUpnpDeviceAsync(e.DiscoveredDevice, cts.Token);
                    if (device != null)
                    {
                        if (discovered.TryAdd(device.Usn, device))
                        {
                            _ = SafeInvokeAsync(onDeviceFound, device, "UPnP device");
                        }

                        _logger.LogDebug(
                            "UPnP: Discovered {Name} ({Type}) at {Location}",
                            device.FriendlyName ?? device.Usn,
                            device.NotificationType,
                            device.DescriptionLocation);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Error processing UPnP device");
                }
            };

            // Start listening for notifications
            locator.StartListeningForNotifications();

            // Send search request
            var devices = await locator.SearchAsync(searchTarget, TimeSpan.FromSeconds(scanDurationSeconds));

            // Process search results
            foreach (var device in devices)
            {
                try
                {
                    var upnpDevice = await CreateUpnpDeviceAsync(device, cts.Token);
                    if (upnpDevice != null)
                    {
                        if (discovered.TryAdd(upnpDevice.Usn, upnpDevice))
                        {
                            _ = SafeInvokeAsync(onDeviceFound, upnpDevice, "UPnP device");
                        }
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogDebug(ex, "Error processing UPnP search result");
                }
            }

            locator.StopListeningForNotifications();
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            _logger.LogWarning(ex, "Error during UPnP/SSDP discovery");
        }

        _logger.LogDebug("UPnP discovery completed: {Count} devices found", discovered.Count);
        return discovered.Values.ToList();
    }

    private Task SafeInvokeAsync<T>(Func<T, Task>? callback, T device, string label)
    {
        if (callback == null)
        {
            return Task.CompletedTask;
        }

        return InvokeSafeAsync(callback, device, label);
    }

    private async Task InvokeSafeAsync<T>(Func<T, Task> callback, T device, string label)
    {
        try
        {
            await callback(device);
        }
        catch (Exception ex)
        {
            _logger.LogDebug(ex, "Failed to send {Label} update", label);
        }
    }

    /// <summary>
    /// Creates an UpnpDiscoveredDevice from an SSDP discovered device.
    /// </summary>
    private async Task<UpnpDiscoveredDevice?> CreateUpnpDeviceAsync(
        DiscoveredSsdpDevice ssdpDevice,
        CancellationToken ct)
    {
        var device = new UpnpDiscoveredDevice
        {
            Usn = ssdpDevice.Usn ?? string.Empty,
            NotificationType = ssdpDevice.NotificationType,
            DescriptionLocation = ssdpDevice.DescriptionLocation?.ToString(),
            IpAddress = ExtractIpAddress(ssdpDevice.DescriptionLocation),
            CacheExpires = ssdpDevice.CacheLifetime != TimeSpan.Zero
                ? DateTime.UtcNow.Add(ssdpDevice.CacheLifetime)
                : null,
            DiscoveredAt = DateTime.UtcNow
        };

        // Try to fetch device description for more details
        if (ssdpDevice.DescriptionLocation != null)
        {
            try
            {
                var details = await FetchDeviceDescriptionAsync(ssdpDevice.DescriptionLocation, ct);
                if (details != null)
                {
                    device = device with
                    {
                        FriendlyName = details.FriendlyName,
                        Manufacturer = details.Manufacturer,
                        ModelName = details.ModelName,
                        ModelNumber = details.ModelNumber,
                        Services = details.Services
                    };
                }
            }
            catch (Exception ex)
            {
                _logger.LogDebug(ex, "Failed to fetch device description from {Location}",
                    ssdpDevice.DescriptionLocation);
            }
        }

        // Extract server header if available
        var headers = ssdpDevice.ResponseHeaders;
        if (headers != null && headers.TryGetValues("SERVER", out var serverValues))
        {
            device = device with { Server = serverValues.FirstOrDefault() };
        }

        return device;
    }

    /// <summary>
    /// Fetches and parses the UPnP device description XML.
    /// </summary>
    private async Task<DeviceDescriptionDetails?> FetchDeviceDescriptionAsync(Uri location, CancellationToken ct)
    {
        try
        {
            var response = await _httpClient.GetStringAsync(location, ct);
            var doc = XDocument.Parse(response);

            // UPnP device description namespace
            XNamespace ns = "urn:schemas-upnp-org:device-1-0";
            var deviceElement = doc.Descendants(ns + "device").FirstOrDefault();

            if (deviceElement == null)
            {
                // Try without namespace
                deviceElement = doc.Descendants("device").FirstOrDefault();
                ns = XNamespace.None;
            }

            if (deviceElement == null)
            {
                return null;
            }

            var services = deviceElement
                .Descendants(ns + "service")
                .Select(s => s.Element(ns + "serviceType")?.Value)
                .Where(s => !string.IsNullOrEmpty(s))
                .Cast<string>()
                .ToList();

            // If no services found with namespace, try without
            if (services.Count == 0)
            {
                services = deviceElement
                    .Descendants("service")
                    .Select(s => s.Element("serviceType")?.Value)
                    .Where(s => !string.IsNullOrEmpty(s))
                    .Cast<string>()
                    .ToList();
            }

            return new DeviceDescriptionDetails
            {
                FriendlyName = GetElementValue(deviceElement, ns, "friendlyName"),
                Manufacturer = GetElementValue(deviceElement, ns, "manufacturer"),
                ModelName = GetElementValue(deviceElement, ns, "modelName"),
                ModelNumber = GetElementValue(deviceElement, ns, "modelNumber"),
                Services = services
            };
        }
        catch
        {
            return null;
        }
    }

    private static string? GetElementValue(XElement parent, XNamespace ns, string name)
    {
        var value = parent.Element(ns + name)?.Value;
        if (string.IsNullOrEmpty(value))
        {
            value = parent.Element(name)?.Value;
        }
        return value;
    }

    private static string? ExtractIpAddress(Uri? uri)
    {
        if (uri == null) return null;

        var host = uri.Host;
        if (IPAddress.TryParse(host, out _))
        {
            return host;
        }

        return null;
    }

    /// <summary>
    /// Internal record for device description details.
    /// </summary>
    private record DeviceDescriptionDetails
    {
        public string? FriendlyName { get; init; }
        public string? Manufacturer { get; init; }
        public string? ModelName { get; init; }
        public string? ModelNumber { get; init; }
        public List<string> Services { get; init; } = [];
    }
}
