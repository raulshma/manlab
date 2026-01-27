import type { NetworkToolTab } from "@/contexts/network-tools-types";

export const NETWORK_TOOL_PERMISSIONS: Record<NetworkToolTab, string> = {
  ping: "network.tools.ping",
  "internet-health": "network.tools.internet-health",
  syslog: "syslog.view",
  "packet-capture": "packet.capture",
  subnet: "network.tools.subnet",
  topology: "network.tools.topology",
  traceroute: "network.tools.traceroute",
  ports: "network.tools.portscan",
  dns: "network.tools.dns",
  snmp: "network.tools.snmp",
  arp: "network.tools.arp",
  "public-ip": "network.tools.public-ip",
  ssl: "network.tools.ssl-inspect",
  discovery: "network.tools.discovery",
  wifi: "network.tools.wifi",
  geodb: "network.tools.geolocation",
  wol: "network.tools.wol",
  speedtest: "network.tools.speedtest",
  subnetcalc: "network.tools.subnet",
  "mac-vendor": "network.tools.mac-vendor",
  history: "network.history.view",
};

export function isNetworkToolAllowed(
  tool: NetworkToolTab,
  hasPermission: (permission: string) => boolean
): boolean {
  const permission = NETWORK_TOOL_PERMISSIONS[tool];
  return hasPermission(permission) || hasPermission("network.tools");
}

export function hasAnyNetworkToolAccess(
  hasPermission: (permission: string) => boolean
): boolean {
  return Object.values(NETWORK_TOOL_PERMISSIONS).some(
    (permission) => hasPermission(permission) || hasPermission("network.tools")
  );
}
