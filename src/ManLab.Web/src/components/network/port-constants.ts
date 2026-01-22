import type { OpenPort } from "@/api/networkApi";

export type RiskLevel = "low" | "medium" | "high" | "critical";
export type ServiceCategory = "web" | "database" | "remote" | "mail" | "file" | "other";

export interface PortInfo {
  port: number;
  serviceName: string | null;
  serviceDescription: string | null;
  category: ServiceCategory;
  risk: RiskLevel;
}

// Common ports with metadata
export const COMMON_PORTS: Record<
  number,
  { service: string; category: ServiceCategory; risk: RiskLevel; description: string }
> = {
  21: { service: "FTP", category: "file", risk: "high", description: "File Transfer Protocol" },
  22: { service: "SSH", category: "remote", risk: "medium", description: "Secure Shell" },
  23: { service: "Telnet", category: "remote", risk: "critical", description: "Unencrypted remote access" },
  25: { service: "SMTP", category: "mail", risk: "medium", description: "Simple Mail Transfer" },
  53: { service: "DNS", category: "other", risk: "low", description: "Domain Name System" },
  80: { service: "HTTP", category: "web", risk: "low", description: "Web Server" },
  110: { service: "POP3", category: "mail", risk: "medium", description: "Post Office Protocol" },
  135: { service: "RPC", category: "other", risk: "high", description: "Windows RPC" },
  139: { service: "NetBIOS", category: "file", risk: "high", description: "Windows File Sharing" },
  143: { service: "IMAP", category: "mail", risk: "medium", description: "Internet Message Access" },
  443: { service: "HTTPS", category: "web", risk: "low", description: "Secure Web Server" },
  445: { service: "SMB", category: "file", risk: "high", description: "Windows File Sharing" },
  993: { service: "IMAPS", category: "mail", risk: "low", description: "Secure IMAP" },
  995: { service: "POP3S", category: "mail", risk: "low", description: "Secure POP3" },
  1433: { service: "MSSQL", category: "database", risk: "medium", description: "Microsoft SQL Server" },
  1521: { service: "Oracle", category: "database", risk: "medium", description: "Oracle Database" },
  3306: { service: "MySQL", category: "database", risk: "medium", description: "MySQL Database" },
  3389: { service: "RDP", category: "remote", risk: "high", description: "Remote Desktop Protocol" },
  5432: { service: "PostgreSQL", category: "database", risk: "medium", description: "PostgreSQL Database" },
  5900: { service: "VNC", category: "remote", risk: "high", description: "Virtual Network Computing" },
  6379: { service: "Redis", category: "database", risk: "medium", description: "Redis Cache" },
  8080: { service: "HTTP-Alt", category: "web", risk: "low", description: "Alternative HTTP" },
  8443: { service: "HTTPS-Alt", category: "web", risk: "low", description: "Alternative HTTPS" },
  27017: { service: "MongoDB", category: "database", risk: "medium", description: "MongoDB Database" },
};

export const ALL_COMMON_PORTS = Object.keys(COMMON_PORTS).map(Number);

export function getPortInfo(port: OpenPort): PortInfo {
  const known = COMMON_PORTS[port.port];
  return {
    port: port.port,
    serviceName: port.serviceName || known?.service || "Unknown",
    serviceDescription: port.serviceDescription || known?.description || null,
    category: known?.category || "other",
    risk: known?.risk || "low",
  };
}

export function getRiskColor(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return "text-green-500";
    case "medium":
      return "text-yellow-500";
    case "high":
      return "text-orange-500";
    case "critical":
      return "text-red-500";
  }
}

export function getRiskBgColor(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return "bg-green-500/10 border-green-500/30";
    case "medium":
      return "bg-yellow-500/10 border-yellow-500/30";
    case "high":
      return "bg-orange-500/10 border-orange-500/30";
    case "critical":
      return "bg-red-500/10 border-red-500/30";
  }
}
