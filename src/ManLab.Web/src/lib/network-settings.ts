import { SettingKeys } from "@/constants/settingKeys";
import { setNotificationsEnabled, setRealtimeEnabled } from "@/lib/network-preferences";

export const NETWORK_STORAGE_KEYS = {
  // Ping Tool
  pingHost: "manlab:network:ping-host",
  pingTimeout: "manlab:network:ping-timeout",
  // Subnet Scanner
  lastSubnet: "manlab:network:last-subnet",
  subnetConcurrency: "manlab:network:subnet-concurrency",
  subnetTimeout: "manlab:network:subnet-timeout",
  // Port Scanner
  portHost: "manlab:network:port-host",
  portConcurrency: "manlab:network:port-concurrency",
  portTimeout: "manlab:network:port-timeout",
  // Traceroute Tool
  tracerouteHost: "manlab:network:traceroute-host",
  tracerouteMaxHops: "manlab:network:traceroute-max-hops",
  tracerouteTimeout: "manlab:network:traceroute-timeout",
  // Device Discovery
  discoveryDuration: "manlab:network:discovery-duration",
  discoveryMode: "manlab:network:discovery-mode",
  // WiFi Scanner
  wifiAdapter: "manlab:network:wifi-adapter",
  wifiBand: "manlab:network:wifi-band",
  wifiSecurity: "manlab:network:wifi-security",
  // Wake-on-LAN
  wolMac: "manlab:network:wol-mac",
  wolBroadcast: "manlab:network:wol-broadcast",
  wolPort: "manlab:network:wol-port",
  // Speed Test
  speedtestDownloadMb: "manlab:network:speedtest-download-mb",
  speedtestUploadMb: "manlab:network:speedtest-upload-mb",
  speedtestLatencySamples: "manlab:network:speedtest-latency-samples",
  // Topology
  topologyCidr: "manlab:network:topology:cidr",
  topologyConcurrency: "manlab:network:topology:concurrency",
  topologyTimeout: "manlab:network:topology:timeout",
  topologyDiscovery: "manlab:network:topology:discovery",
  topologyDiscoveryDuration: "manlab:network:topology:discovery-duration",
} as const;

export interface NetworkPreferences {
  // Global preferences
  realtimeEnabled: boolean;
  notificationsEnabled: boolean;
  // Ping defaults
  pingHost: string;
  pingTimeout: number;
  // Subnet defaults
  lastSubnet: string;
  subnetConcurrency: number;
  subnetTimeout: number;
  // Port scan defaults
  portHost: string;
  portConcurrency: number;
  portTimeout: number;
  // Traceroute defaults
  tracerouteHost: string;
  tracerouteMaxHops: number;
  tracerouteTimeout: number;
  // Discovery defaults
  discoveryDuration: number;
  discoveryMode: "both" | "mdns" | "upnp";
  // WiFi defaults
  wifiAdapter: string;
  wifiBand: "all" | "2.4" | "5" | "6";
  wifiSecurity: "all" | "secured" | "open";
  // Wake-on-LAN defaults
  wolMac: string;
  wolBroadcast: string;
  wolPort: number;
  // Speed test defaults
  speedtestDownloadMb: number;
  speedtestUploadMb: number;
  speedtestLatencySamples: number;
  // Topology defaults
  topologyCidr: string;
  topologyConcurrency: number;
  topologyTimeout: number;
  topologyIncludeDiscovery: boolean;
  topologyDiscoveryDuration: number;
}

export interface SystemSetting {
  key: string;
  value: string | null;
  category: string;
  description: string | null;
}

export const DEFAULT_NETWORK_PREFERENCES: NetworkPreferences = {
  realtimeEnabled: true,
  notificationsEnabled: true,
  pingHost: "",
  pingTimeout: 1000,
  lastSubnet: "",
  subnetConcurrency: 100,
  subnetTimeout: 500,
  portHost: "",
  portConcurrency: 50,
  portTimeout: 2000,
  tracerouteHost: "",
  tracerouteMaxHops: 30,
  tracerouteTimeout: 1000,
  discoveryDuration: 10,
  discoveryMode: "both",
  wifiAdapter: "",
  wifiBand: "all",
  wifiSecurity: "all",
  wolMac: "",
  wolBroadcast: "",
  wolPort: 9,
  speedtestDownloadMb: 10,
  speedtestUploadMb: 5,
  speedtestLatencySamples: 3,
  topologyCidr: "",
  topologyConcurrency: 120,
  topologyTimeout: 750,
  topologyIncludeDiscovery: true,
  topologyDiscoveryDuration: 6,
};

export function parseNumberValue(value: string | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function parseBooleanValue(value: string | null | undefined, fallback: boolean): boolean {
  if (!value) return fallback;
  const normalized = value.trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(normalized)) return true;
  if (["false", "0", "no", "off"].includes(normalized)) return false;
  return fallback;
}

export function parseEnumValue<T extends string>(
  value: string | null | undefined,
  allowed: readonly T[],
  fallback: T
): T {
  if (!value) return fallback;
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function loadNetworkPreferences(settings?: SystemSetting[] | null): NetworkPreferences {
  if (!settings || settings.length === 0) return DEFAULT_NETWORK_PREFERENCES;

  const get = (key: string) => settings.find((s) => s.key === key)?.value ?? null;

  return {
    realtimeEnabled: parseBooleanValue(get(SettingKeys.Network.RealtimeEnabled), DEFAULT_NETWORK_PREFERENCES.realtimeEnabled),
    notificationsEnabled: parseBooleanValue(get(SettingKeys.Network.NotificationsEnabled), DEFAULT_NETWORK_PREFERENCES.notificationsEnabled),
    pingHost: get(SettingKeys.Network.PingHost) ?? DEFAULT_NETWORK_PREFERENCES.pingHost,
    pingTimeout: parseNumberValue(get(SettingKeys.Network.PingTimeout), DEFAULT_NETWORK_PREFERENCES.pingTimeout),
    lastSubnet: get(SettingKeys.Network.SubnetLast) ?? DEFAULT_NETWORK_PREFERENCES.lastSubnet,
    subnetConcurrency: parseNumberValue(get(SettingKeys.Network.SubnetConcurrency), DEFAULT_NETWORK_PREFERENCES.subnetConcurrency),
    subnetTimeout: parseNumberValue(get(SettingKeys.Network.SubnetTimeout), DEFAULT_NETWORK_PREFERENCES.subnetTimeout),
    portHost: get(SettingKeys.Network.PortHost) ?? DEFAULT_NETWORK_PREFERENCES.portHost,
    portConcurrency: parseNumberValue(get(SettingKeys.Network.PortConcurrency), DEFAULT_NETWORK_PREFERENCES.portConcurrency),
    portTimeout: parseNumberValue(get(SettingKeys.Network.PortTimeout), DEFAULT_NETWORK_PREFERENCES.portTimeout),
    tracerouteHost: get(SettingKeys.Network.TracerouteHost) ?? DEFAULT_NETWORK_PREFERENCES.tracerouteHost,
    tracerouteMaxHops: parseNumberValue(get(SettingKeys.Network.TracerouteMaxHops), DEFAULT_NETWORK_PREFERENCES.tracerouteMaxHops),
    tracerouteTimeout: parseNumberValue(get(SettingKeys.Network.TracerouteTimeout), DEFAULT_NETWORK_PREFERENCES.tracerouteTimeout),
    discoveryDuration: parseNumberValue(get(SettingKeys.Network.DiscoveryDuration), DEFAULT_NETWORK_PREFERENCES.discoveryDuration),
    discoveryMode: parseEnumValue(get(SettingKeys.Network.DiscoveryMode), ["both", "mdns", "upnp"] as const, DEFAULT_NETWORK_PREFERENCES.discoveryMode),
    wifiAdapter: get(SettingKeys.Network.WifiAdapter) ?? DEFAULT_NETWORK_PREFERENCES.wifiAdapter,
    wifiBand: parseEnumValue(get(SettingKeys.Network.WifiBand), ["all", "2.4", "5", "6"] as const, DEFAULT_NETWORK_PREFERENCES.wifiBand),
    wifiSecurity: parseEnumValue(get(SettingKeys.Network.WifiSecurity), ["all", "secured", "open"] as const, DEFAULT_NETWORK_PREFERENCES.wifiSecurity),
    wolMac: get(SettingKeys.Network.WolMac) ?? DEFAULT_NETWORK_PREFERENCES.wolMac,
    wolBroadcast: get(SettingKeys.Network.WolBroadcast) ?? DEFAULT_NETWORK_PREFERENCES.wolBroadcast,
    wolPort: parseNumberValue(get(SettingKeys.Network.WolPort), DEFAULT_NETWORK_PREFERENCES.wolPort),
    speedtestDownloadMb: parseNumberValue(get(SettingKeys.Network.SpeedtestDownloadMb), DEFAULT_NETWORK_PREFERENCES.speedtestDownloadMb),
    speedtestUploadMb: parseNumberValue(get(SettingKeys.Network.SpeedtestUploadMb), DEFAULT_NETWORK_PREFERENCES.speedtestUploadMb),
    speedtestLatencySamples: parseNumberValue(get(SettingKeys.Network.SpeedtestLatencySamples), DEFAULT_NETWORK_PREFERENCES.speedtestLatencySamples),
    topologyCidr: get(SettingKeys.Network.TopologyCidr) ?? DEFAULT_NETWORK_PREFERENCES.topologyCidr,
    topologyConcurrency: parseNumberValue(get(SettingKeys.Network.TopologyConcurrency), DEFAULT_NETWORK_PREFERENCES.topologyConcurrency),
    topologyTimeout: parseNumberValue(get(SettingKeys.Network.TopologyTimeout), DEFAULT_NETWORK_PREFERENCES.topologyTimeout),
    topologyIncludeDiscovery: parseBooleanValue(get(SettingKeys.Network.TopologyIncludeDiscovery), DEFAULT_NETWORK_PREFERENCES.topologyIncludeDiscovery),
    topologyDiscoveryDuration: parseNumberValue(get(SettingKeys.Network.TopologyDiscoveryDuration), DEFAULT_NETWORK_PREFERENCES.topologyDiscoveryDuration),
  };
}

export function saveNetworkPreferences(prefs: NetworkPreferences): void {
  if (typeof window === "undefined") return;

  setRealtimeEnabled(prefs.realtimeEnabled);
  setNotificationsEnabled(prefs.notificationsEnabled);

  localStorage.setItem(NETWORK_STORAGE_KEYS.pingHost, prefs.pingHost);
  localStorage.setItem(NETWORK_STORAGE_KEYS.pingTimeout, String(prefs.pingTimeout));
  localStorage.setItem(NETWORK_STORAGE_KEYS.lastSubnet, prefs.lastSubnet);
  localStorage.setItem(NETWORK_STORAGE_KEYS.subnetConcurrency, String(prefs.subnetConcurrency));
  localStorage.setItem(NETWORK_STORAGE_KEYS.subnetTimeout, String(prefs.subnetTimeout));
  localStorage.setItem(NETWORK_STORAGE_KEYS.portHost, prefs.portHost);
  localStorage.setItem(NETWORK_STORAGE_KEYS.portConcurrency, String(prefs.portConcurrency));
  localStorage.setItem(NETWORK_STORAGE_KEYS.portTimeout, String(prefs.portTimeout));
  localStorage.setItem(NETWORK_STORAGE_KEYS.tracerouteHost, prefs.tracerouteHost);
  localStorage.setItem(NETWORK_STORAGE_KEYS.tracerouteMaxHops, String(prefs.tracerouteMaxHops));
  localStorage.setItem(NETWORK_STORAGE_KEYS.tracerouteTimeout, String(prefs.tracerouteTimeout));
  localStorage.setItem(NETWORK_STORAGE_KEYS.discoveryDuration, String(prefs.discoveryDuration));
  localStorage.setItem(NETWORK_STORAGE_KEYS.discoveryMode, prefs.discoveryMode);
  localStorage.setItem(NETWORK_STORAGE_KEYS.wifiAdapter, prefs.wifiAdapter);
  localStorage.setItem(NETWORK_STORAGE_KEYS.wifiBand, prefs.wifiBand);
  localStorage.setItem(NETWORK_STORAGE_KEYS.wifiSecurity, prefs.wifiSecurity);
  localStorage.setItem(NETWORK_STORAGE_KEYS.wolMac, prefs.wolMac);
  localStorage.setItem(NETWORK_STORAGE_KEYS.wolBroadcast, prefs.wolBroadcast);
  localStorage.setItem(NETWORK_STORAGE_KEYS.wolPort, String(prefs.wolPort));
  localStorage.setItem(NETWORK_STORAGE_KEYS.speedtestDownloadMb, String(prefs.speedtestDownloadMb));
  localStorage.setItem(NETWORK_STORAGE_KEYS.speedtestUploadMb, String(prefs.speedtestUploadMb));
  localStorage.setItem(NETWORK_STORAGE_KEYS.speedtestLatencySamples, String(prefs.speedtestLatencySamples));
  localStorage.setItem(NETWORK_STORAGE_KEYS.topologyCidr, prefs.topologyCidr);
  localStorage.setItem(NETWORK_STORAGE_KEYS.topologyConcurrency, String(prefs.topologyConcurrency));
  localStorage.setItem(NETWORK_STORAGE_KEYS.topologyTimeout, String(prefs.topologyTimeout));
  localStorage.setItem(NETWORK_STORAGE_KEYS.topologyDiscovery, String(prefs.topologyIncludeDiscovery));
  localStorage.setItem(NETWORK_STORAGE_KEYS.topologyDiscoveryDuration, String(prefs.topologyDiscoveryDuration));
}

export function buildNetworkSettingsPayload(values: NetworkPreferences): SystemSetting[] {
  return [
    { key: SettingKeys.Network.RealtimeEnabled, value: String(values.realtimeEnabled), category: "Network", description: "Enable real-time network updates" },
    { key: SettingKeys.Network.NotificationsEnabled, value: String(values.notificationsEnabled), category: "Network", description: "Enable network tool notifications" },
    { key: SettingKeys.Network.PingHost, value: values.pingHost || null, category: "Network", description: "Default ping target" },
    { key: SettingKeys.Network.PingTimeout, value: String(values.pingTimeout), category: "Network", description: "Ping timeout in milliseconds" },
    { key: SettingKeys.Network.SubnetLast, value: values.lastSubnet || null, category: "Network", description: "Default subnet for scanning" },
    { key: SettingKeys.Network.SubnetConcurrency, value: String(values.subnetConcurrency), category: "Network", description: "Subnet scan concurrency" },
    { key: SettingKeys.Network.SubnetTimeout, value: String(values.subnetTimeout), category: "Network", description: "Subnet scan timeout in milliseconds" },
    { key: SettingKeys.Network.PortHost, value: values.portHost || null, category: "Network", description: "Default port scan target" },
    { key: SettingKeys.Network.PortConcurrency, value: String(values.portConcurrency), category: "Network", description: "Port scan concurrency" },
    { key: SettingKeys.Network.PortTimeout, value: String(values.portTimeout), category: "Network", description: "Port scan timeout in milliseconds" },
    { key: SettingKeys.Network.TracerouteHost, value: values.tracerouteHost || null, category: "Network", description: "Default traceroute target" },
    { key: SettingKeys.Network.TracerouteMaxHops, value: String(values.tracerouteMaxHops), category: "Network", description: "Traceroute maximum hops" },
    { key: SettingKeys.Network.TracerouteTimeout, value: String(values.tracerouteTimeout), category: "Network", description: "Traceroute timeout per hop in milliseconds" },
    { key: SettingKeys.Network.DiscoveryDuration, value: String(values.discoveryDuration), category: "Network", description: "Device discovery scan duration in seconds" },
    { key: SettingKeys.Network.DiscoveryMode, value: values.discoveryMode, category: "Network", description: "Device discovery protocol mode" },
    { key: SettingKeys.Network.WifiAdapter, value: values.wifiAdapter || null, category: "Network", description: "Preferred WiFi adapter name" },
    { key: SettingKeys.Network.WifiBand, value: values.wifiBand, category: "Network", description: "WiFi band filter" },
    { key: SettingKeys.Network.WifiSecurity, value: values.wifiSecurity, category: "Network", description: "WiFi security filter" },
    { key: SettingKeys.Network.WolMac, value: values.wolMac || null, category: "Network", description: "Default Wake-on-LAN MAC address" },
    { key: SettingKeys.Network.WolBroadcast, value: values.wolBroadcast || null, category: "Network", description: "Wake-on-LAN broadcast address" },
    { key: SettingKeys.Network.WolPort, value: String(values.wolPort), category: "Network", description: "Wake-on-LAN port" },
    { key: SettingKeys.Network.SpeedtestDownloadMb, value: String(values.speedtestDownloadMb), category: "Network", description: "Speed test download payload size in MB" },
    { key: SettingKeys.Network.SpeedtestUploadMb, value: String(values.speedtestUploadMb), category: "Network", description: "Speed test upload payload size in MB" },
    { key: SettingKeys.Network.SpeedtestLatencySamples, value: String(values.speedtestLatencySamples), category: "Network", description: "Speed test latency sample count" },
    { key: SettingKeys.Network.TopologyCidr, value: values.topologyCidr || null, category: "Network", description: "Default topology scan CIDR" },
    { key: SettingKeys.Network.TopologyConcurrency, value: String(values.topologyConcurrency), category: "Network", description: "Topology scan concurrency" },
    { key: SettingKeys.Network.TopologyTimeout, value: String(values.topologyTimeout), category: "Network", description: "Topology scan timeout in milliseconds" },
    { key: SettingKeys.Network.TopologyIncludeDiscovery, value: String(values.topologyIncludeDiscovery), category: "Network", description: "Include discovery results in topology" },
    { key: SettingKeys.Network.TopologyDiscoveryDuration, value: String(values.topologyDiscoveryDuration), category: "Network", description: "Topology discovery duration in seconds" },
  ];
}

export function applyNetworkSettingsToStorage(settings?: SystemSetting[] | null): NetworkPreferences {
  const prefs = loadNetworkPreferences(settings);
  saveNetworkPreferences(prefs);
  return prefs;
}
