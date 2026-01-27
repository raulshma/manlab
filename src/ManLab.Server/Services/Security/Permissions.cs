using ManLab.Server.Data.Enums;

namespace ManLab.Server.Services.Security;

public static class Permissions
{
    public const string ClaimType = "perm";
    public const string PolicyPrefix = "Permission:";
    public const string NetworkToolsPrefix = "network.tools.";

    public const string UsersManage = "users.manage";
    public const string SettingsManage = "settings.manage";

    public const string DevicesView = "devices.view";
    public const string DevicesManage = "devices.manage";
    public const string OnboardingManage = "onboarding.manage";

    public const string MonitoringView = "monitoring.view";
    public const string MonitoringManage = "monitoring.manage";

    public const string NetworkTools = "network.tools";
    public const string NetworkHistoryView = "network.history.view";

    public const string NetworkToolsPing = "network.tools.ping";
    public const string NetworkToolsInternetHealth = "network.tools.internet-health";
    public const string NetworkToolsSubnetScan = "network.tools.subnet";
    public const string NetworkToolsTopology = "network.tools.topology";
    public const string NetworkToolsTraceroute = "network.tools.traceroute";
    public const string NetworkToolsPortScan = "network.tools.portscan";
    public const string NetworkToolsDeviceInfo = "network.tools.device-info";
    public const string NetworkToolsDnsLookup = "network.tools.dns";
    public const string NetworkToolsDnsPropagation = "network.tools.dns-propagation";
    public const string NetworkToolsSnmp = "network.tools.snmp";
    public const string NetworkToolsWhois = "network.tools.whois";
    public const string NetworkToolsWol = "network.tools.wol";
    public const string NetworkToolsMacVendor = "network.tools.mac-vendor";
    public const string NetworkToolsArp = "network.tools.arp";
    public const string NetworkToolsSpeedTest = "network.tools.speedtest";
    public const string NetworkToolsPublicIp = "network.tools.public-ip";
    public const string NetworkToolsSslInspect = "network.tools.ssl-inspect";
    public const string NetworkToolsDiscovery = "network.tools.discovery";
    public const string NetworkToolsWifi = "network.tools.wifi";
    public const string NetworkToolsGeolocation = "network.tools.geolocation";

    public const string LogsView = "logs.view";
    public const string AuditView = "audit.view";
    public const string SyslogView = "syslog.view";

    public const string ScriptsView = "scripts.view";
    public const string ScriptsManage = "scripts.manage";
    public const string ScriptsRun = "scripts.run";

    public const string TerminalUse = "terminal.use";
    public const string FileBrowserView = "filebrowser.view";
    public const string FileBrowserWrite = "filebrowser.write";
    public const string LogViewerUse = "logviewer.use";

    public const string PacketCapture = "packet.capture";
    public const string BinariesDownload = "binaries.download";

    public static readonly IReadOnlyList<string> All =
    [
        UsersManage,
        SettingsManage,
        DevicesView,
        DevicesManage,
        OnboardingManage,
        MonitoringView,
        MonitoringManage,
        NetworkTools,
        NetworkHistoryView,
        NetworkToolsPing,
        NetworkToolsInternetHealth,
        NetworkToolsSubnetScan,
        NetworkToolsTopology,
        NetworkToolsTraceroute,
        NetworkToolsPortScan,
        NetworkToolsDeviceInfo,
        NetworkToolsDnsLookup,
        NetworkToolsDnsPropagation,
        NetworkToolsSnmp,
        NetworkToolsWhois,
        NetworkToolsWol,
        NetworkToolsMacVendor,
        NetworkToolsArp,
        NetworkToolsSpeedTest,
        NetworkToolsPublicIp,
        NetworkToolsSslInspect,
        NetworkToolsDiscovery,
        NetworkToolsWifi,
        NetworkToolsGeolocation,
        LogsView,
        AuditView,
        SyslogView,
        ScriptsView,
        ScriptsManage,
        ScriptsRun,
        TerminalUse,
        FileBrowserView,
        FileBrowserWrite,
        LogViewerUse,
        PacketCapture,
        BinariesDownload
    ];

    public static readonly IReadOnlyDictionary<string, string> NetworkToolTypePermissions =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            ["ping"] = NetworkToolsPing,
            ["internet-health"] = NetworkToolsInternetHealth,
            ["subnet"] = NetworkToolsSubnetScan,
            ["subnet-scan"] = NetworkToolsSubnetScan,
            ["topology"] = NetworkToolsTopology,
            ["traceroute"] = NetworkToolsTraceroute,
            ["port-scan"] = NetworkToolsPortScan,
            ["ports"] = NetworkToolsPortScan,
            ["device-info"] = NetworkToolsDeviceInfo,
            ["dns"] = NetworkToolsDnsLookup,
            ["dns-lookup"] = NetworkToolsDnsLookup,
            ["dns-propagation"] = NetworkToolsDnsPropagation,
            ["snmp"] = NetworkToolsSnmp,
            ["snmp-query"] = NetworkToolsSnmp,
            ["whois"] = NetworkToolsWhois,
            ["wol"] = NetworkToolsWol,
            ["mac-vendor"] = NetworkToolsMacVendor,
            ["arp"] = NetworkToolsArp,
            ["arp-table"] = NetworkToolsArp,
            ["speedtest"] = NetworkToolsSpeedTest,
            ["public-ip"] = NetworkToolsPublicIp,
            ["ssl"] = NetworkToolsSslInspect,
            ["ssl-inspect"] = NetworkToolsSslInspect,
            ["discovery"] = NetworkToolsDiscovery,
            ["wifi"] = NetworkToolsWifi,
            ["wifi-scan"] = NetworkToolsWifi,
            ["geolocation"] = NetworkToolsGeolocation,
            ["geoip"] = NetworkToolsGeolocation
        };

    public static bool TryGetNetworkToolPermission(string toolType, out string permission)
    {
        if (string.IsNullOrWhiteSpace(toolType))
        {
            permission = string.Empty;
            return false;
        }

        return NetworkToolTypePermissions.TryGetValue(toolType.Trim(), out permission!);
    }

    public static IReadOnlyCollection<string> GetRoleDefaults(UserRole role)
    {
        return role == UserRole.Admin
            ? All
            :
            [
                DevicesView,
                MonitoringView,
                LogsView,
                NetworkHistoryView
            ];
    }

    public static string PolicyFor(string permission) => $"{PolicyPrefix}{permission}";
}
