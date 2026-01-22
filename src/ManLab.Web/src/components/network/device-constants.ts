import {
  HardDrive,
  Printer,
  Radar,
  Router,
  Server,
  Smartphone,
  Tv2,
} from "lucide-react";

/**
 * Device type constants and categorization for network device discovery
 */

export type DeviceType = "all" | "printer" | "media" | "iot" | "network" | "storage" | "other";

export const DEVICE_TYPE_ICONS: Record<DeviceType, React.ComponentType<{ className?: string }>> = {
  all: Radar,
  printer: Printer,
  media: Tv2,
  iot: Smartphone,
  network: Router,
  storage: HardDrive,
  other: Server,
};

export const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  all: "All Devices",
  printer: "Printers",
  media: "Media Devices",
  iot: "IoT Devices",
  network: "Network Devices",
  storage: "Storage",
  other: "Other",
};

const SERVICE_TYPE_CATEGORIES: Record<string, DeviceType> = {
  "_ipp._tcp": "printer",
  "_printer._tcp": "printer",
  "_pdl-datastream._tcp": "printer",
  "_airplay._tcp": "media",
  "_raop._tcp": "media",
  "_googlecast._tcp": "media",
  "_spotify-connect._tcp": "media",
  "_sonos._tcp": "media",
  "_daap._tcp": "media",
  "_homekit._tcp": "iot",
  "_hap._tcp": "iot",
  "_hue._tcp": "iot",
  "_smb._tcp": "storage",
  "_nfs._tcp": "storage",
  "_afpovertcp._tcp": "storage",
  "_ftp._tcp": "storage",
  "_sftp-ssh._tcp": "storage",
  "_ssh._tcp": "network",
  "_http._tcp": "network",
  "_https._tcp": "network",
  "_workstation._tcp": "network",
};

const UPNP_TYPE_CATEGORIES: Record<string, DeviceType> = {
  "MediaServer": "media",
  "MediaRenderer": "media",
  "InternetGatewayDevice": "network",
  "WANDevice": "network",
  "WFADevice": "network",
  "Printer": "printer",
  "ScannerDevice": "printer",
  "BasicDevice": "other",
};

export function getMdnsDeviceType(serviceType: string): DeviceType {
  const normalized = serviceType.toLowerCase();
  for (const [pattern, category] of Object.entries(SERVICE_TYPE_CATEGORIES)) {
    if (normalized.includes(pattern.toLowerCase())) {
      return category;
    }
  }
  return "other";
}

export function getUpnpDeviceType(deviceType: string | null): DeviceType {
  if (!deviceType) return "other";
  for (const [pattern, category] of Object.entries(UPNP_TYPE_CATEGORIES)) {
    if (deviceType.toLowerCase().includes(pattern.toLowerCase())) {
      return category;
    }
  }
  return "other";
}
