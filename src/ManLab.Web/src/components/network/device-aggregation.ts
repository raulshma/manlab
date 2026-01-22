/**
 * Device Aggregation Utilities
 * Groups discovered devices by IP address to eliminate duplicates
 */

import type { MdnsService, UpnpDevice } from "@/api/networkApi";

// ============================================================================
// Types
// ============================================================================

/** Aggregated device with all discovered services on the same IP */
export interface AggregatedDevice {
  /** Primary IP address */
  ipAddress: string;
  /** All hostnames discovered */
  hostnames: string[];
  /** All mDNS services found on this IP */
  mdnsServices: MdnsService[];
  /** All UPnP devices found on this IP */
  upnpDevices: UpnpDevice[];
  /** Primary display name */
  displayName: string;
  /** Primary protocol (for badge) */
  primaryProtocol: "mdns" | "upnp" | "both";
  /** All unique ports discovered */
  ports: number[];
  /** Network interfaces seen */
  networkInterfaces: string[];
}

// ============================================================================
// Helper functions
// ============================================================================

/**
 * Get primary IP from mDNS service
 */
function getMdnsIp(service: MdnsService): string | null {
  const ips = service.ipAddresses ?? [];
  // Prefer non-link-local IPv4 addresses
  const ipv4 = ips.find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith("169.254."));
  if (ipv4) return ipv4;
  // Fallback to first available IP
  return ips[0] ?? null;
}

/**
 * Get primary IP from UPnP device (from location URL)
 */
function getUpnpIp(device: UpnpDevice): string | null {
  const location = device.location ?? device.descriptionLocation;
  if (!location) return device.ipAddress ?? null;
  try {
    const url = new URL(location);
    return url.hostname || device.ipAddress || null;
  } catch {
    return device.ipAddress ?? null;
  }
}

/**
 * Aggregate devices by IP address
 */
export function aggregateDevicesByIp(
  mdnsServices: MdnsService[],
  upnpDevices: UpnpDevice[]
): AggregatedDevice[] {
  const deviceMap = new Map<string, AggregatedDevice>();

  // Process mDNS services
  for (const service of mdnsServices) {
    const ip = getMdnsIp(service);
    if (!ip) continue;

    if (!deviceMap.has(ip)) {
      deviceMap.set(ip, {
        ipAddress: ip,
        hostnames: [],
        mdnsServices: [],
        upnpDevices: [],
        displayName: "",
        primaryProtocol: "mdns",
        ports: [],
        networkInterfaces: [],
      });
    }

    const device = deviceMap.get(ip)!;
    device.mdnsServices.push(service);
    
    if (service.hostname && !device.hostnames.includes(service.hostname)) {
      device.hostnames.push(service.hostname);
    }
    
    if (service.port && !device.ports.includes(service.port)) {
      device.ports.push(service.port);
    }
    
    if (service.networkInterface && !device.networkInterfaces.includes(service.networkInterface)) {
      device.networkInterfaces.push(service.networkInterface);
    }
  }

  // Process UPnP devices
  for (const upnpDevice of upnpDevices) {
    const ip = getUpnpIp(upnpDevice);
    if (!ip) continue;

    if (!deviceMap.has(ip)) {
      deviceMap.set(ip, {
        ipAddress: ip,
        hostnames: [],
        mdnsServices: [],
        upnpDevices: [],
        displayName: "",
        primaryProtocol: "upnp",
        ports: [],
        networkInterfaces: [],
      });
    }

    const device = deviceMap.get(ip)!;
    device.upnpDevices.push(upnpDevice);

    // Update protocol if we have both
    if (device.mdnsServices.length > 0) {
      device.primaryProtocol = "both";
    }
  }

  // Set display names and finalize
  for (const device of deviceMap.values()) {
    // Prefer UPnP friendly name, then mDNS service name, then hostname
    const upnpName = device.upnpDevices.find((d) => d.friendlyName)?.friendlyName;
    const mdnsName = device.mdnsServices.find((s) => s.serviceName || s.name)?.serviceName
      || device.mdnsServices.find((s) => s.name)?.name;
    const hostname = device.hostnames[0];
    
    device.displayName = upnpName || mdnsName || hostname || device.ipAddress;
    
    // Sort ports
    device.ports.sort((a, b) => a - b);
  }

  // Convert to array and sort by IP
  return Array.from(deviceMap.values()).sort((a, b) => {
    const aParts = a.ipAddress.split(".").map(Number);
    const bParts = b.ipAddress.split(".").map(Number);
    for (let i = 0; i < 4; i++) {
      if (aParts[i] !== bParts[i]) return aParts[i] - bParts[i];
    }
    return 0;
  });
}
