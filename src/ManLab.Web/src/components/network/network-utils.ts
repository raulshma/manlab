/**
 * Utility functions for network components
 */

import { notify } from "@/lib/network-notify";

/**
 * Check if a network is open based on security type
 */
export function isOpenNetwork(securityType: string | undefined | null): boolean {
  if (!securityType) return true; // No security type means open network
  return securityType.toLowerCase().includes("open") || securityType.trim() === "";
}

/**
 * Normalize WiFi band to a standard format
 */
export function normalizeBand(band: string | undefined | null): "2.4" | "5" | "6" | "unknown" {
  if (!band) return "unknown";
  const normalized = band.toLowerCase();
  if (normalized.includes("2.4")) return "2.4";
  if (normalized.includes("5")) return "5";
  if (normalized.includes("6")) return "6";
  return "unknown";
}

/**
 * Copy text to clipboard with notification
 */
export async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify.success("Copied to clipboard");
  } catch {
    notify.error("Failed to copy");
  }
}

/**
 * Get icon name for service based on port number or service name
 */
export function getServiceIcon(service: string | null, port: number): string {
  const lowerService = (service || "").toLowerCase();

  // Common services
  if (lowerService.includes("http") || port === 80 || port === 443 || port === 8080)
    return "Globe";
  if (lowerService.includes("ssh") || port === 22) return "Terminal";
  if (lowerService.includes("ftp") || port === 21 || port === 20) return "FolderOpen";
  if (lowerService.includes("smtp") || port === 25 || port === 587) return "Mail";
  if (lowerService.includes("dns") || port === 53) return "Server";
  if (lowerService.includes("database") || lowerService.includes("sql") || port === 3306 || port === 5432)
    return "Database";

  return "Network";
}

/**
 * Get service category based on port number or service name
 */
export function getServiceCategory(service: string | null, port: number): string {
  const lowerService = (service || "").toLowerCase();

  if (lowerService.includes("http") || port === 80 || port === 443 || port === 8080)
    return "Web";
  if (lowerService.includes("ssh") || lowerService.includes("telnet") || port === 22 || port === 23)
    return "Remote Access";
  if (lowerService.includes("ftp") || lowerService.includes("smb") || port === 21 || port === 445)
    return "File Transfer";
  if (lowerService.includes("smtp") || lowerService.includes("pop") || lowerService.includes("imap"))
    return "Email";
  if (lowerService.includes("dns") || port === 53) return "DNS";
  if (lowerService.includes("database") || lowerService.includes("sql"))
    return "Database";

  return "Other";
}

/**
 * Get device type icon based on device discovery info
 */
export function getDeviceTypeIcon(deviceType?: string): string {
  const type = (deviceType || "").toLowerCase();

  if (type.includes("router") || type.includes("gateway")) return "Router";
  if (type.includes("printer")) return "Printer";
  if (type.includes("phone") || type.includes("mobile")) return "Smartphone";
  if (type.includes("computer") || type.includes("pc") || type.includes("laptop"))
    return "Monitor";
  if (type.includes("server")) return "Server";
  if (type.includes("camera")) return "Camera";
  if (type.includes("tv") || type.includes("television") || type.includes("display"))
    return "Tv";
  if (type.includes("speaker") || type.includes("audio")) return "Speaker";

  return "HardDrive";
}

/**
 * Get vendor/manufacturer from OUI (MAC address prefix)
 */
export function getVendorCategory(vendor?: string): string {
  if (!vendor) return "Unknown";

  const lowerVendor = vendor.toLowerCase();

  if (lowerVendor.includes("apple") || lowerVendor.includes("cupertino")) return "Apple";
  if (lowerVendor.includes("samsung")) return "Samsung";
  if (lowerVendor.includes("cisco")) return "Cisco";
  if (lowerVendor.includes("tp-link") || lowerVendor.includes("tplink")) return "TP-Link";
  if (lowerVendor.includes("netgear")) return "Netgear";
  if (lowerVendor.includes("dell")) return "Dell";
  if (lowerVendor.includes("hp") || lowerVendor.includes("hewlett")) return "HP";
  if (lowerVendor.includes("intel")) return "Intel";
  if (lowerVendor.includes("raspberry")) return "Raspberry Pi";

  return vendor;
}
