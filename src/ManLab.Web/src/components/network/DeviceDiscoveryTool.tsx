/**
 * DeviceDiscoveryTool Component
 * Discover smart devices using mDNS and UPnP protocols.
 * Features:
 * - Scan duration slider (1-30 seconds)
 * - Toggle: mDNS only / UPnP only / Both
 * - Live device cards as discovered
 * - Filter by protocol (mDNS / UPnP)
 * - Filter by service type (Printer, Media, IoT, etc.)
 * - Search by device name
 */

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Radar,
  Loader2,
  Copy,
  Search,
  Filter,
  RefreshCw,
  Printer,
  Tv2,
  Smartphone,
  Router,
  Server,
  HardDrive,
  Globe,
  Link,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Trash2,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { toast } from "sonner";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import type { MdnsService, UpnpDevice } from "@/api/networkApi";

// ============================================================================
// Types
// ============================================================================

type DiscoveryMode = "both" | "mdns" | "upnp";
type DeviceType = "all" | "printer" | "media" | "iot" | "network" | "storage" | "other";

interface DiscoveryState {
  isScanning: boolean;
  scanDuration: number;
  progress: number;
  elapsedSeconds: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEVICE_TYPE_ICONS: Record<DeviceType, React.ComponentType<{ className?: string }>> = {
  all: Radar,
  printer: Printer,
  media: Tv2,
  iot: Smartphone,
  network: Router,
  storage: HardDrive,
  other: Server,
};

const DEVICE_TYPE_LABELS: Record<DeviceType, string> = {
  all: "All Devices",
  printer: "Printers",
  media: "Media Devices",
  iot: "IoT Devices",
  network: "Network Devices",
  storage: "Storage",
  other: "Other",
};

// Service type mappings for categorization
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

// UPnP device type mappings
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

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Get device type category from mDNS service type
 */
function getMdnsDeviceType(serviceType: string): DeviceType {
  const normalized = serviceType.toLowerCase();
  for (const [pattern, category] of Object.entries(SERVICE_TYPE_CATEGORIES)) {
    if (normalized.includes(pattern.toLowerCase())) {
      return category;
    }
  }
  return "other";
}

/**
 * Get device type category from UPnP device type
 */
function getUpnpDeviceType(deviceType: string | null): DeviceType {
  if (!deviceType) return "other";
  for (const [pattern, category] of Object.entries(UPNP_TYPE_CATEGORIES)) {
    if (deviceType.toLowerCase().includes(pattern.toLowerCase())) {
      return category;
    }
  }
  return "other";
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  toast.success("Copied to clipboard");
}

/**
 * Export devices to JSON
 */
function exportToJSON(mdnsServices: MdnsService[], upnpDevices: UpnpDevice[]): void {
  const data = {
    exportDate: new Date().toISOString(),
    mdnsServices,
    upnpDevices,
  };
  const json = JSON.stringify(data, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `device-discovery-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ============================================================================
// mDNS Service Card Component
// ============================================================================

interface MdnsServiceCardProps {
  service: MdnsService;
}

function MdnsServiceCard({ service }: MdnsServiceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const deviceType = getMdnsDeviceType(service.serviceType);
  const DeviceIcon = DEVICE_TYPE_ICONS[deviceType];
  const hasTxtRecords = Object.keys(service.txtRecords).length > 0;

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
            <DeviceIcon className="h-5 w-5 text-blue-500" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Service Name */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-medium truncate" title={service.serviceName}>
                  {service.serviceName}
                </h4>
                <p className="text-xs text-muted-foreground font-mono truncate" title={service.serviceType}>
                  {service.serviceType}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Badge variant="secondary" className="text-xs">mDNS</Badge>
                <Badge variant="outline" className="text-xs capitalize">
                  {deviceType}
                </Badge>
              </div>
            </div>

            {/* Hostname & Port */}
            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                <span className="truncate" title={service.hostname}>
                  {service.hostname}
                </span>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                Port: {service.port}
              </Badge>
            </div>

            {/* IP Addresses */}
            <div className="flex flex-wrap gap-1">
              {service.ipAddresses.map((ip, idx) => (
                <Tooltip key={idx}>
                  <TooltipTrigger>
                    <Badge
                      variant="secondary"
                      className="text-xs font-mono cursor-pointer hover:bg-secondary/80"
                      onClick={() => copyToClipboard(ip)}
                    >
                      {ip}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>Click to copy</TooltipContent>
                </Tooltip>
              ))}
            </div>

            {/* Network Interface */}
            {service.networkInterface && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Router className="h-3 w-3" />
                <span>Interface: {service.networkInterface}</span>
              </div>
            )}

            {/* TXT Records (Collapsible) */}
            {hasTxtRecords && (
              <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger
                  className="inline-flex h-7 px-2 text-xs gap-1 items-center justify-center rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  TXT Records ({Object.keys(service.txtRecords).length})
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="rounded-md border bg-muted/50 p-2 text-xs font-mono space-y-1">
                    {Object.entries(service.txtRecords).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-muted-foreground">{key}:</span>
                        <span className="break-all">{value || "(empty)"}</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-1 mt-3 pt-3 border-t">
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(service.serviceName)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy Name</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(service.ipAddresses.join(", "))}
              >
                <Link className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy IPs</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// UPnP Device Card Component
// ============================================================================

interface UpnpDeviceCardProps {
  device: UpnpDevice;
}

function UpnpDeviceCard({ device }: UpnpDeviceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const deviceType = getUpnpDeviceType(device.deviceType);
  const DeviceIcon = DEVICE_TYPE_ICONS[deviceType];
  const hasServices = device.services.length > 0;

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
            <DeviceIcon className="h-5 w-5 text-green-500" />
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-2">
            {/* Friendly Name */}
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-medium truncate" title={device.friendlyName || "Unknown Device"}>
                  {device.friendlyName || "Unknown Device"}
                </h4>
                {device.deviceType && (
                  <p className="text-xs text-muted-foreground truncate" title={device.deviceType}>
                    {device.deviceType.split(":").pop()}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600">
                  UPnP
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">
                  {deviceType}
                </Badge>
              </div>
            </div>

            {/* Manufacturer & Model */}
            {(device.manufacturer || device.modelName) && (
              <div className="text-sm text-muted-foreground">
                {device.manufacturer && <span>{device.manufacturer}</span>}
                {device.manufacturer && device.modelName && <span> • </span>}
                {device.modelName && <span>{device.modelName}</span>}
                {device.modelNumber && <span className="text-xs"> ({device.modelNumber})</span>}
              </div>
            )}

            {/* USN (Unique Service Name) */}
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono truncate">
              <span title={device.usn}>{device.usn.length > 50 ? device.usn.slice(0, 50) + "..." : device.usn}</span>
            </div>

            {/* Services List (Collapsible) */}
            {hasServices && (
              <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger
                  className="inline-flex h-7 px-2 text-xs gap-1 items-center justify-center rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  Services ({device.services.length})
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="rounded-md border bg-muted/50 p-2 text-xs font-mono space-y-1">
                    {device.services.map((service, idx) => (
                      <div key={idx} className="truncate" title={service}>
                        {service.split(":").pop()}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-1 mt-3 pt-3 border-t">
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(device.friendlyName || device.usn)}
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy Name</TooltipContent>
          </Tooltip>
          {device.location && (
            <Tooltip>
              <TooltipTrigger>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(device.location!, "_blank")}
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View Device XML</TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function DeviceDiscoveryTool() {
  // Configuration state
  const [scanDuration, setScanDuration] = useState(5);
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>("both");

  // Discovery state
  const [discoveryState, setDiscoveryState] = useState<DiscoveryState>({
    isScanning: false,
    scanDuration: 0,
    progress: 0,
    elapsedSeconds: 0,
  });

  // Results state
  const [mdnsServices, setMdnsServices] = useState<MdnsService[]>([]);
  const [upnpDevices, setUpnpDevices] = useState<UpnpDevice[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [protocolFilter, setProtocolFilter] = useState<"all" | "mdns" | "upnp">("all");
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<DeviceType>("all");

  // SignalR connection
  const {
    isConnected,
    discoverDevices,
    subscribeToDiscovery,
  } = useNetworkHub();

  // Progress timer
  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    if (discoveryState.isScanning) {
      timer = setInterval(() => {
        setDiscoveryState((prev) => {
          const elapsed = prev.elapsedSeconds + 1;
          const progress = Math.min((elapsed / prev.scanDuration) * 100, 100);
          return { ...prev, elapsedSeconds: elapsed, progress };
        });
      }, 1000);
    }

    return () => {
      if (timer) clearInterval(timer);
    };
  }, [discoveryState.isScanning, discoveryState.scanDuration]);

  // Subscribe to discovery events
  useEffect(() => {
    const unsubscribe = subscribeToDiscovery({
      onDiscoveryStarted: (event) => {
        setDiscoveryState({
          isScanning: true,
          scanDuration: event.durationSeconds,
          progress: 0,
          elapsedSeconds: 0,
        });
        setMdnsServices([]);
        setUpnpDevices([]);
        toast.info(`Discovery started: ${event.durationSeconds}s scan`);
      },
      onMdnsDeviceFound: (event) => {
        setMdnsServices((prev) => {
          // Avoid duplicates by checking hostname + service type
          const isDuplicate = prev.some(
            (s) => s.hostname === event.service.hostname && s.serviceType === event.service.serviceType
          );
          if (isDuplicate) return prev;
          return [...prev, event.service];
        });
      },
      onUpnpDeviceFound: (event) => {
        setUpnpDevices((prev) => {
          // Avoid duplicates by USN
          const isDuplicate = prev.some((d) => d.usn === event.device.usn);
          if (isDuplicate) return prev;
          return [...prev, event.device];
        });
      },
      onDiscoveryCompleted: (event) => {
        setDiscoveryState((prev) => ({
          ...prev,
          isScanning: false,
          progress: 100,
        }));
        const totalDevices = event.result.mdnsServices.length + event.result.upnpDevices.length;
        toast.success(
          `Discovery complete: ${totalDevices} devices found in ${(event.result.scanDurationMs / 1000).toFixed(1)}s`
        );
      },
    });

    return unsubscribe;
  }, [subscribeToDiscovery]);

  // Start discovery
  const handleStartDiscovery = useCallback(async () => {
    if (!isConnected) {
      toast.error("Not connected to server. Please wait...");
      return;
    }

    try {
      setDiscoveryState({
        isScanning: true,
        scanDuration,
        progress: 0,
        elapsedSeconds: 0,
      });
      await discoverDevices(scanDuration);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start discovery";
      toast.error(errorMessage);
      setDiscoveryState((prev) => ({ ...prev, isScanning: false }));
    }
  }, [scanDuration, isConnected, discoverDevices]);

  // Clear results
  const handleClearResults = useCallback(() => {
    setMdnsServices([]);
    setUpnpDevices([]);
    setDiscoveryState({
      isScanning: false,
      scanDuration: 0,
      progress: 0,
      elapsedSeconds: 0,
    });
    toast.info("Results cleared");
  }, []);

  // Filtered results
  const filteredMdnsServices = useMemo(() => {
    if (protocolFilter === "upnp") return [];
    let services = mdnsServices;

    // Filter by search query
    if (filterQuery) {
      const lowerQuery = filterQuery.toLowerCase();
      services = services.filter(
        (s) =>
          s.serviceName.toLowerCase().includes(lowerQuery) ||
          s.hostname.toLowerCase().includes(lowerQuery) ||
          s.serviceType.toLowerCase().includes(lowerQuery)
      );
    }

    // Filter by device type
    if (deviceTypeFilter !== "all") {
      services = services.filter((s) => getMdnsDeviceType(s.serviceType) === deviceTypeFilter);
    }

    return services;
  }, [mdnsServices, filterQuery, protocolFilter, deviceTypeFilter]);

  const filteredUpnpDevices = useMemo(() => {
    if (protocolFilter === "mdns") return [];
    let devices = upnpDevices;

    // Filter by search query
    if (filterQuery) {
      const lowerQuery = filterQuery.toLowerCase();
      devices = devices.filter(
        (d) =>
          d.friendlyName?.toLowerCase().includes(lowerQuery) ||
          d.manufacturer?.toLowerCase().includes(lowerQuery) ||
          d.modelName?.toLowerCase().includes(lowerQuery) ||
          d.deviceType?.toLowerCase().includes(lowerQuery)
      );
    }

    // Filter by device type
    if (deviceTypeFilter !== "all") {
      devices = devices.filter((d) => getUpnpDeviceType(d.deviceType) === deviceTypeFilter);
    }

    return devices;
  }, [upnpDevices, filterQuery, protocolFilter, deviceTypeFilter]);

  const totalFiltered = filteredMdnsServices.length + filteredUpnpDevices.length;
  const totalDevices = mdnsServices.length + upnpDevices.length;

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Radar className="h-5 w-5" />
            Device Discovery
          </CardTitle>
          <CardDescription>
            Discover smart devices on your network using mDNS (Bonjour/Avahi) and UPnP/SSDP protocols
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-[1fr_200px_auto]">
            {/* Scan Duration Slider */}
            <div className="space-y-2">
              <Label>Scan Duration: {scanDuration} seconds</Label>
              <Slider
                value={[scanDuration]}
                onValueChange={(value) => {
                  const newValue = Array.isArray(value) ? value[0] : value;
                  setScanDuration(newValue);
                }}
                min={1}
                max={30}
                step={1}
                disabled={discoveryState.isScanning}
                className="mt-3"
              />
              <p className="text-xs text-muted-foreground">
                Longer duration allows more devices to respond
              </p>
            </div>

            {/* Discovery Mode */}
            <div className="space-y-2">
              <Label>Discovery Mode</Label>
              <Select
                value={discoveryMode}
                onValueChange={(v) => setDiscoveryMode(v as DiscoveryMode)}
                disabled={discoveryState.isScanning}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="both">Both (mDNS + UPnP)</SelectItem>
                  <SelectItem value="mdns">mDNS Only</SelectItem>
                  <SelectItem value="upnp">UPnP Only</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Detection protocol</p>
            </div>

            {/* Submit Button */}
            <div className="flex items-end">
              <Button
                onClick={handleStartDiscovery}
                disabled={discoveryState.isScanning || !isConnected}
                className="w-full lg:w-auto"
              >
                {discoveryState.isScanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Discovering...
                  </>
                ) : (
                  <>
                    <Radar className="mr-2 h-4 w-4" />
                    Start Discovery
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Connection Status Warning */}
          {!isConnected && (
            <div className="mt-4 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg text-yellow-600 dark:text-yellow-400 text-sm flex items-center gap-2">
              <RefreshCw className="h-4 w-4 animate-spin" />
              Connecting to server... Real-time updates require WebSocket connection.
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress Section */}
      {discoveryState.isScanning && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Discovery progress</span>
                <span className="font-medium">
                  {discoveryState.elapsedSeconds}s / {discoveryState.scanDuration}s
                </span>
              </div>
              <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary transition-all duration-1000 ease-linear"
                  style={{ width: `${discoveryState.progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5 text-blue-500">
                    <Badge variant="secondary" className="text-xs">mDNS</Badge>
                    {mdnsServices.length} services
                  </span>
                  <span className="flex items-center gap-1.5 text-green-500">
                    <Badge variant="secondary" className="text-xs bg-green-500/10">UPnP</Badge>
                    {upnpDevices.length} devices
                  </span>
                </div>
                <span className="text-muted-foreground">
                  {discoveryState.progress.toFixed(0)}% complete
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Section */}
      {totalDevices > 0 && (
        <>
          {/* Results Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-medium">
                Discovered Devices ({totalFiltered})
              </h3>
              {totalFiltered !== totalDevices && (
                <Badge variant="secondary">
                  Showing {totalFiltered} of {totalDevices}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search Filter */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search devices..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="pl-8 w-[180px]"
                />
              </div>

              {/* Protocol Filter */}
              <Select
                value={protocolFilter}
                onValueChange={(v) => setProtocolFilter(v as "all" | "mdns" | "upnp")}
              >
                <SelectTrigger className="w-[120px]">
                  <Filter className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="mdns">mDNS</SelectItem>
                  <SelectItem value="upnp">UPnP</SelectItem>
                </SelectContent>
              </Select>

              {/* Device Type Filter */}
              <Select
                value={deviceTypeFilter}
                onValueChange={(v) => setDeviceTypeFilter(v as DeviceType)}
              >
                <SelectTrigger className="w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DEVICE_TYPE_LABELS).map(([value, label]) => (
                    <SelectItem key={value} value={value}>
                      {label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Export Button */}
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => exportToJSON(mdnsServices, upnpDevices)}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export to JSON</TooltipContent>
              </Tooltip>

              {/* Clear Button */}
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleClearResults}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear Results</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* mDNS Services Section */}
          {filteredMdnsServices.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Badge variant="secondary" className="text-xs">mDNS</Badge>
                Services ({filteredMdnsServices.length})
              </h4>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredMdnsServices.map((service, idx) => (
                  <MdnsServiceCard key={`${service.hostname}-${service.serviceType}-${idx}`} service={service} />
                ))}
              </div>
            </div>
          )}

          {/* UPnP Devices Section */}
          {filteredUpnpDevices.length > 0 && (
            <div className="space-y-3">
              <h4 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600">UPnP</Badge>
                Devices ({filteredUpnpDevices.length})
              </h4>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {filteredUpnpDevices.map((device) => (
                  <UpnpDeviceCard key={device.usn} device={device} />
                ))}
              </div>
            </div>
          )}

          {/* No Results After Filter */}
          {totalFiltered === 0 && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center justify-center py-12 text-center">
                <Filter className="h-12 w-12 mb-4 text-muted-foreground opacity-50" />
                <h3 className="text-lg font-medium mb-2">No matching devices</h3>
                <p className="text-sm text-muted-foreground max-w-sm">
                  Try adjusting your filters or search query to find devices.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    setFilterQuery("");
                    setProtocolFilter("all");
                    setDeviceTypeFilter("all");
                  }}
                >
                  Clear Filters
                </Button>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Empty State */}
      {!discoveryState.isScanning && totalDevices === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Radar className="h-12 w-12 mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No devices discovered yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Click "Start Discovery" to find smart devices on your network using mDNS 
              (Bonjour) and UPnP protocols. This will detect printers, media servers, 
              IoT devices, and more.
            </p>
            <Button onClick={handleStartDiscovery} disabled={!isConnected}>
              <Radar className="mr-2 h-4 w-4" />
              Start Discovery
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Scan Complete Summary */}
      {!discoveryState.isScanning && totalDevices > 0 && discoveryState.progress === 100 && (
        <Card className="bg-green-500/5 border-green-500/30">
          <CardContent className="py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <Radar className="h-5 w-5" />
                <span className="font-medium">
                  Discovery complete! Found {totalDevices} device{totalDevices !== 1 ? "s" : ""}.
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={handleStartDiscovery}>
                <RefreshCw className="mr-2 h-4 w-4" />
                Scan Again
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
