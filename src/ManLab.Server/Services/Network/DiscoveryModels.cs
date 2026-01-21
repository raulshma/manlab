namespace ManLab.Server.Services.Network;

/// <summary>
/// Represents a device discovered via mDNS (Multicast DNS / Bonjour / Avahi).
/// </summary>
public record MdnsDiscoveredDevice
{
    /// <summary>
    /// The service instance name (e.g., "My Printer").
    /// </summary>
    public required string Name { get; init; }
    
    /// <summary>
    /// The service type (e.g., "_http._tcp", "_printer._tcp").
    /// </summary>
    public required string ServiceType { get; init; }
    
    /// <summary>
    /// The hostname of the device.
    /// </summary>
    public string? Hostname { get; init; }
    
    /// <summary>
    /// The IP addresses of the device.
    /// </summary>
    public List<string> IpAddresses { get; init; } = [];
    
    /// <summary>
    /// The port the service is running on.
    /// </summary>
    public int Port { get; init; }
    
    /// <summary>
    /// TXT record data (key-value pairs).
    /// </summary>
    public Dictionary<string, string> TxtRecords { get; init; } = [];
    
    /// <summary>
    /// The network interface the device was discovered on.
    /// </summary>
    public string? NetworkInterface { get; init; }
    
    /// <summary>
    /// When this device was discovered.
    /// </summary>
    public DateTime DiscoveredAt { get; init; } = DateTime.UtcNow;
}

/// <summary>
/// Represents a device discovered via SSDP/UPnP.
/// </summary>
public record UpnpDiscoveredDevice
{
    /// <summary>
    /// The unique service name (USN).
    /// </summary>
    public required string Usn { get; init; }
    
    /// <summary>
    /// The notification type (NT) or search target (ST).
    /// </summary>
    public string? NotificationType { get; init; }
    
    /// <summary>
    /// The location URL of the device description XML.
    /// </summary>
    public string? DescriptionLocation { get; init; }
    
    /// <summary>
    /// The friendly name of the device (from description XML).
    /// </summary>
    public string? FriendlyName { get; init; }
    
    /// <summary>
    /// The manufacturer of the device.
    /// </summary>
    public string? Manufacturer { get; init; }
    
    /// <summary>
    /// The model name of the device.
    /// </summary>
    public string? ModelName { get; init; }
    
    /// <summary>
    /// The model number of the device.
    /// </summary>
    public string? ModelNumber { get; init; }
    
    /// <summary>
    /// The IP address of the device.
    /// </summary>
    public string? IpAddress { get; init; }
    
    /// <summary>
    /// The server header value.
    /// </summary>
    public string? Server { get; init; }
    
    /// <summary>
    /// List of services provided by this device.
    /// </summary>
    public List<string> Services { get; init; } = [];
    
    /// <summary>
    /// When this device was discovered.
    /// </summary>
    public DateTime DiscoveredAt { get; init; } = DateTime.UtcNow;
    
    /// <summary>
    /// When the device cache expires.
    /// </summary>
    public DateTime? CacheExpires { get; init; }
}

/// <summary>
/// Result of a discovery scan operation.
/// </summary>
public record DiscoveryScanResult
{
    /// <summary>
    /// Devices discovered via mDNS.
    /// </summary>
    public List<MdnsDiscoveredDevice> MdnsDevices { get; init; } = [];
    
    /// <summary>
    /// Devices discovered via UPnP/SSDP.
    /// </summary>
    public List<UpnpDiscoveredDevice> UpnpDevices { get; init; } = [];
    
    /// <summary>
    /// When the scan started.
    /// </summary>
    public DateTime StartedAt { get; init; }
    
    /// <summary>
    /// When the scan completed.
    /// </summary>
    public DateTime CompletedAt { get; init; }
    
    /// <summary>
    /// Duration of the scan in milliseconds.
    /// </summary>
    public long DurationMs => (long)(CompletedAt - StartedAt).TotalMilliseconds;
    
    /// <summary>
    /// Total number of devices discovered.
    /// </summary>
    public int TotalDevices => MdnsDevices.Count + UpnpDevices.Count;
}

/// <summary>
/// Common mDNS service types for discovery.
/// </summary>
public static class MdnsServiceTypes
{
    public const string AllServices = "_services._dns-sd._udp";
    public const string Workstation = "_workstation._tcp";
    public const string Http = "_http._tcp";
    public const string Https = "_https._tcp";
    public const string Ssh = "_ssh._tcp";
    public const string Sftp = "_sftp-ssh._tcp";
    public const string Ftp = "_ftp._tcp";
    public const string Smb = "_smb._tcp";
    public const string Afp = "_afp._tcp";
    public const string Printer = "_printer._tcp";
    public const string Ipp = "_ipp._tcp";
    public const string IppS = "_ipps._tcp";
    public const string AirPlay = "_airplay._tcp";
    public const string Raop = "_raop._tcp";
    public const string Spotify = "_spotify-connect._tcp";
    public const string GoogleCast = "_googlecast._tcp";
    public const string HomeKit = "_hap._tcp";
    public const string HomeAssistant = "_home-assistant._tcp";
    public const string Mqtt = "_mqtt._tcp";
    public const string Esphome = "_esphomelib._tcp";
    
    /// <summary>
    /// Gets the common service types for network device discovery.
    /// </summary>
    public static readonly string[] CommonTypes =
    [
        Workstation,
        Http,
        Https,
        Ssh,
        Printer,
        Ipp,
        Smb,
        GoogleCast,
        AirPlay,
        HomeKit,
        HomeAssistant
    ];
}
