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
    // Meta-query to discover all available service types
    public const string AllServices = "_services._dns-sd._udp";
    
    // Workstation and general
    public const string Workstation = "_workstation._tcp";
    public const string Device = "_device-info._tcp";
    public const string Sleep = "_sleep-proxy._udp";
    
    // Web and network services
    public const string Http = "_http._tcp";
    public const string Https = "_https._tcp";
    public const string HttpAlt = "_http-alt._tcp";
    public const string WebDav = "_webdav._tcp";
    public const string WebDavS = "_webdavs._tcp";
    
    // Remote access
    public const string Ssh = "_ssh._tcp";
    public const string Sftp = "_sftp-ssh._tcp";
    public const string Ftp = "_ftp._tcp";
    public const string Telnet = "_telnet._tcp";
    public const string Vnc = "_rfb._tcp";
    public const string Rdp = "_rdp._tcp";
    
    // File sharing
    public const string Smb = "_smb._tcp";
    public const string Afp = "_afp._tcp";
    public const string Nfs = "_nfs._tcp";
    
    // Printing
    public const string Printer = "_printer._tcp";
    public const string Ipp = "_ipp._tcp";
    public const string IppS = "_ipps._tcp";
    public const string Pdl = "_pdl-datastream._tcp";
    public const string Scanner = "_scanner._tcp";
    public const string Uscan = "_uscan._tcp";
    public const string Uscans = "_uscans._tcp";
    
    // Apple ecosystem
    public const string AirPlay = "_airplay._tcp";
    public const string AirPlay2 = "_airplay2._tcp";
    public const string Raop = "_raop._tcp";
    public const string AirPrint = "_ipp._tcp";
    public const string AppleTv = "_appletv-v2._tcp";
    public const string AppleRemoteDesktop = "_net-assistant._tcp";
    public const string TimeMachine = "_adisk._tcp";
    public const string AirDrop = "_airdrop._tcp";
    public const string Companion = "_companion-link._tcp";
    
    // Media and streaming
    public const string GoogleCast = "_googlecast._tcp";
    public const string Spotify = "_spotify-connect._tcp";
    public const string Sonos = "_sonos._tcp";
    public const string Daap = "_daap._tcp"; // iTunes/DAAP
    public const string Dacp = "_dacp._tcp"; // iTunes remote
    public const string Plex = "_plex._tcp";
    public const string Dlna = "_dlna._tcp";
    public const string Upnp = "_upnp._tcp";
    public const string Roku = "_roku._tcp";
    public const string AmazonEcho = "_amzn-wplay._tcp";
    public const string Kodi = "_xbmc-jsonrpc._tcp";
    
    // Smart home and IoT
    public const string HomeKit = "_hap._tcp";
    public const string HomeAssistant = "_home-assistant._tcp";
    public const string Mqtt = "_mqtt._tcp";
    public const string Esphome = "_esphomelib._tcp";
    public const string Hue = "_hue._tcp";
    public const string SmartThings = "_smartthings._tcp";
    public const string Wemo = "_wemo._tcp";
    public const string Tuya = "_tuya._tcp";
    public const string Matter = "_matter._tcp";
    public const string MatterCommissioning = "_matterc._udp";
    public const string Thread = "_meshcop._udp";
    
    // Cameras and security
    public const string Onvif = "_onvif-bnep._udp";
    public const string Rtsp = "_rtsp._tcp";
    public const string Camera = "_axis-video._tcp";
    public const string NestCam = "_nest-cam._tcp";
    
    // Network infrastructure
    public const string Dns = "_dns._udp";
    public const string DnsLlq = "_dns-llq._udp";
    public const string DnsUpdate = "_dns-update._udp";
    public const string Ntp = "_ntp._udp";
    public const string Snmp = "_snmp._udp";
    public const string Syslog = "_syslog._udp";
    
    // Gaming
    public const string Steam = "_steam-streaming._tcp";
    public const string Xbox = "_xbox._tcp";
    public const string PlayStation = "_playstation._tcp";
    public const string NintendoSwitch = "_nintendo._tcp";
    
    // Communication
    public const string Sip = "_sip._udp";
    public const string Xmpp = "_xmpp-client._tcp";
    
    /// <summary>
    /// Gets the comprehensive service types for network device discovery.
    /// Note: AllServices meta-query is not included as Tmds.MDns library doesn't support it properly.
    /// </summary>
    public static readonly string[] CommonTypes =
    [
        // Core services
        Workstation,
        Device,
        Http,
        Https,
        Ssh,
        Sftp,
        Ftp,
        Vnc,
        Rdp,
        
        // File sharing
        Smb,
        Afp,
        Nfs,
        
        // Printing and scanning
        Printer,
        Ipp,
        IppS,
        Scanner,
        Uscan,
        
        // Apple ecosystem
        AirPlay,
        Raop,
        AppleTv,
        TimeMachine,
        Companion,
        
        // Media and streaming
        GoogleCast,
        Spotify,
        Sonos,
        Daap,
        Plex,
        Roku,
        AmazonEcho,
        Kodi,
        
        // Smart home and IoT
        HomeKit,
        HomeAssistant,
        Mqtt,
        Esphome,
        Hue,
        Matter,
        MatterCommissioning,
        
        // Cameras
        Rtsp,
        Camera,
    ];
    
    /// <summary>
    /// Extended service types for thorough discovery (includes less common types).
    /// </summary>
    public static readonly string[] ExtendedTypes =
    [
        .. CommonTypes,
        Sleep,
        HttpAlt,
        WebDav,
        WebDavS,
        Telnet,
        Pdl,
        Uscans,
        AirPlay2,
        AirDrop,
        AppleRemoteDesktop,
        Dacp,
        Dlna,
        Upnp,
        SmartThings,
        Wemo,
        Tuya,
        Thread,
        Onvif,
        NestCam,
        Dns,
        Ntp,
        Snmp,
        Syslog,
        Steam,
        Xbox,
        PlayStation,
        NintendoSwitch,
        Sip,
        Xmpp,
    ];
}
