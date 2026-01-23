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

import { useMemo, useRef, useState, useCallback, useEffect } from "react";
import {
  Radar,
  Loader2,
  Search,
  Filter,
  RefreshCw,
  Trash2,
  Download,
  AlertTriangle,
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
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/network-notify";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import {
  discoverMdns,
  discoverUpnp,
  type MdnsService,
  type DiscoveryScanResult,
  type UpnpDevice,
} from "@/api/networkApi";
import { AggregatedDeviceCard } from "@/components/network/AggregatedDeviceCard";
import { aggregateDevicesByIp } from "@/components/network/device-aggregation";
import {
  DEVICE_TYPE_LABELS,
  getMdnsDeviceType,
  getUpnpDeviceType,
  type DeviceType,
} from "@/components/network/device-constants";
import { announce, announceScanEvent } from "@/lib/accessibility";

// ============================================================================
// Types
// ============================================================================

type DiscoveryMode = "both" | "mdns" | "upnp";
interface DiscoveryState {
  isScanning: boolean;
  scanDuration: number;
  progress: number;
  elapsedSeconds: number;
}

const DISCOVERY_DURATION_KEY = "manlab:network:discovery-duration";
const DISCOVERY_MODE_KEY = "manlab:network:discovery-mode";

// ============================================================================
// Constants
// ============================================================================

function getStoredString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function getStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
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

type MdnsServiceLike = MdnsService & {
  name?: string;
};

type UpnpDeviceLike = UpnpDevice & {
  notificationType?: string | null;
  descriptionLocation?: string | null;
};

function normalizeMdnsService(raw: MdnsServiceLike): MdnsService {
  return {
    serviceName: raw.serviceName ?? raw.name ?? "Unknown service",
    name: raw.name,
    serviceType: raw.serviceType ?? "unknown",
    hostname: raw.hostname ?? null,
    ipAddresses: raw.ipAddresses ?? [],
    port: raw.port ?? 0,
    txtRecords: raw.txtRecords ?? {},
    networkInterface: raw.networkInterface ?? null,
  };
}

function normalizeUpnpDevice(raw: UpnpDeviceLike): UpnpDevice {
  return {
    ...raw,
    deviceType: raw.deviceType ?? raw.notificationType ?? null,
    location: raw.location ?? raw.descriptionLocation ?? null,
    services: raw.services ?? [],
  };
}

// ============================================================================
// Main Component
// ============================================================================

export function DeviceDiscoveryTool() {
  // Configuration state
  const [scanDuration, setScanDuration] = useState(() => getStoredNumber(DISCOVERY_DURATION_KEY, 10));
  const [discoveryMode, setDiscoveryMode] = useState<DiscoveryMode>(
    () => getStoredString(DISCOVERY_MODE_KEY, "both") as DiscoveryMode
  );
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

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
  const abortRef = useRef<AbortController | null>(null);

  const debouncedFilterQuery = useDebouncedValue(filterQuery, 200);

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

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(DISCOVERY_DURATION_KEY, String(scanDuration));
    localStorage.setItem(DISCOVERY_MODE_KEY, discoveryMode);
  }, [scanDuration, discoveryMode]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // Subscribe to discovery events
  useEffect(() => {
    if (!isConnected) {
      return;
    }

    const unsubscribe = subscribeToDiscovery({
      onDiscoveryStarted: (event) => {
        setRateLimitMessage(null);
        setDiscoveryState({
          isScanning: true,
          scanDuration: event.durationSeconds,
          progress: 0,
          elapsedSeconds: 0,
        });
        setMdnsServices([]);
        setUpnpDevices([]);
        notify.info(`Discovery started: ${event.durationSeconds}s scan`);
      },
      onMdnsDeviceFound: (event) => {
        setMdnsServices((prev) => {
          const raw = (event as { service?: MdnsServiceLike; device?: MdnsServiceLike }).service
            ?? (event as { device?: MdnsServiceLike }).device;
          if (!raw) return prev;
          const service = normalizeMdnsService(raw);
          // Avoid duplicates by checking hostname + service type
          const isDuplicate = prev.some(
            (s) => (s.hostname ?? "") === (service.hostname ?? "") && s.serviceType === service.serviceType
          );
          if (isDuplicate) return prev;
          return [...prev, service];
        });
      },
      onUpnpDeviceFound: (event) => {
        setUpnpDevices((prev) => {
          const device = normalizeUpnpDevice(event.device as UpnpDeviceLike);
          // Avoid duplicates by USN
          const isDuplicate = prev.some((d) => d.usn === device.usn);
          if (isDuplicate) return prev;
          return [...prev, device];
        });
      },
      onDiscoveryCompleted: (event) => {
        setDiscoveryState((prev) => ({
          ...prev,
          isScanning: false,
          progress: 100,
        }));

        const payload = event as typeof event | DiscoveryScanResult | undefined;
        const result = payload && "result" in payload ? payload.result ?? payload : payload;
        if (!result) {
          notify.error("Discovery completed without results.");
          announceScanEvent("completed", "Device discovery", "No results received");
          return;
        }

        const mdnsRaw = (Array.isArray(result.mdnsServices ?? result.mdnsDevices)
          ? (result.mdnsServices ?? result.mdnsDevices)
          : []) as MdnsServiceLike[];
        const upnpRaw = (Array.isArray(result.upnpDevices)
          ? result.upnpDevices
          : []) as UpnpDeviceLike[];

        const mdns = mdnsRaw.map(normalizeMdnsService);
        const upnp = upnpRaw.map(normalizeUpnpDevice);
        const totalDevices = mdns.length + upnp.length;
        notify.success(
          `Discovery complete: ${totalDevices} devices found in ${(((result.scanDurationMs ?? result.durationMs ?? 0) / 1000) || 0).toFixed(1)}s`
        );
        announceScanEvent(
          "completed",
          "Device discovery",
          `Found ${totalDevices} devices`
        );
      },
    });

    return unsubscribe;
  }, [isConnected, subscribeToDiscovery]);

  // Start discovery
  const handleStartDiscovery = useCallback(async () => {
    if (discoveryMode === "both" && !isConnected) {
      notify.error("Not connected to server. Please wait...");
      return;
    }

    try {
      setRateLimitMessage(null);
      setDiscoveryState({
        isScanning: true,
        scanDuration,
        progress: 0,
        elapsedSeconds: 0,
      });

      if (discoveryMode === "mdns") {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const result = await discoverMdns(
          { scanDurationSeconds: scanDuration },
          { signal: controller.signal }
        );
        const services = Array.isArray(result)
          ? result
          : (result.services ?? result.mdnsDevices ?? []);
        setMdnsServices(services.map(normalizeMdnsService));
        setUpnpDevices([]);
        setDiscoveryState((prev) => ({ ...prev, isScanning: false, progress: 100 }));
        notify.success(
          `mDNS discovery complete: ${services.length} services found in ${(((result.scanDurationMs ?? result.durationMs ?? 0) / 1000) || 0).toFixed(1)}s`
        );
        return;
      }

      if (discoveryMode === "upnp") {
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const result = await discoverUpnp(
          { scanDurationSeconds: scanDuration },
          { signal: controller.signal }
        );
        setMdnsServices([]);
        const devices = Array.isArray(result)
          ? result
          : (result.devices ?? result.upnpDevices ?? []);
        setUpnpDevices(devices.map(normalizeUpnpDevice));
        setDiscoveryState((prev) => ({ ...prev, isScanning: false, progress: 100 }));
        notify.success(
          `UPnP discovery complete: ${devices.length} devices found in ${(((result.scanDurationMs ?? result.durationMs ?? 0) / 1000) || 0).toFixed(1)}s`
        );
        return;
      }

      await discoverDevices(scanDuration);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start discovery";
      if (errorMessage.toLowerCase().includes("rate") || errorMessage.includes("429")) {
        setRateLimitMessage("Rate limit reached. Please wait before retrying.");
      }
      notify.error(errorMessage);
      setDiscoveryState((prev) => ({ ...prev, isScanning: false }));
    }
  }, [scanDuration, isConnected, discoverDevices, discoveryMode]);

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
    notify.info("Results cleared");
    announce("Discovery results cleared", "polite");
  }, []);

  // Aggregate devices by IP address
  const aggregatedDevices = useMemo(() => {
    return aggregateDevicesByIp(mdnsServices, upnpDevices);
  }, [mdnsServices, upnpDevices]);

  // Filtered aggregated devices
  const filteredDevices = useMemo(() => {
    let devices = aggregatedDevices;

    // Filter by protocol
    if (protocolFilter === "mdns") {
      devices = devices.filter((d) => d.mdnsServices.length > 0);
    } else if (protocolFilter === "upnp") {
      devices = devices.filter((d) => d.upnpDevices.length > 0);
    }

    // Filter by search query
    if (debouncedFilterQuery) {
      const lowerQuery = debouncedFilterQuery.toLowerCase();
      devices = devices.filter(
        (d) =>
          d.displayName.toLowerCase().includes(lowerQuery) ||
          d.ipAddress.toLowerCase().includes(lowerQuery) ||
          d.hostnames.some((h) => h.toLowerCase().includes(lowerQuery)) ||
          d.mdnsServices.some(
            (s) =>
              (s.serviceName ?? s.name ?? "").toLowerCase().includes(lowerQuery) ||
              (s.serviceType ?? "").toLowerCase().includes(lowerQuery)
          ) ||
          d.upnpDevices.some(
            (u) =>
              u.friendlyName?.toLowerCase().includes(lowerQuery) ||
              u.manufacturer?.toLowerCase().includes(lowerQuery) ||
              u.modelName?.toLowerCase().includes(lowerQuery)
          )
      );
    }

    // Filter by device type
    if (deviceTypeFilter !== "all") {
      devices = devices.filter((d) => {
        const hasMdnsMatch = d.mdnsServices.some(
          (s) => getMdnsDeviceType(s.serviceType ?? "") === deviceTypeFilter
        );
        const hasUpnpMatch = d.upnpDevices.some(
          (u) => getUpnpDeviceType(u.deviceType ?? u.notificationType ?? null) === deviceTypeFilter
        );
        return hasMdnsMatch || hasUpnpMatch;
      });
    }

    return devices;
  }, [aggregatedDevices, debouncedFilterQuery, protocolFilter, deviceTypeFilter]);

  const totalFiltered = filteredDevices.length;
  const totalDevices = aggregatedDevices.length;
  const totalServices = mdnsServices.length + upnpDevices.length;

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
            Discover smart devices on your network using mDNS (Bonjour/Avahi) and UPnP/SSDP protocols.
            Devices that do not advertise these protocols (phones, laptops, many IoT devices) may not appear—use Subnet Scan for a full inventory.
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
                className="w-full lg:w-auto min-h-11"
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

      {rateLimitMessage && (
        <Card className="border-orange-500/40 bg-orange-500/5">
          <CardContent className="pt-4 flex items-center gap-2 text-sm text-orange-600 dark:text-orange-400">
            <AlertTriangle className="h-4 w-4" />
            {rateLimitMessage}
          </CardContent>
        </Card>
      )}

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

      {discoveryState.isScanning && totalDevices === 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
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
              <Badge variant="outline" className="text-xs">
                {totalServices} service{totalServices !== 1 ? "s" : ""} total
              </Badge>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search Filter */}
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search devices..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="pl-8 w-45"
                />
              </div>

              {/* Protocol Filter */}
              <Select
                value={protocolFilter}
                onValueChange={(v) => setProtocolFilter(v as "all" | "mdns" | "upnp")}
              >
                <SelectTrigger className="w-30">
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
                <SelectTrigger className="w-35">
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
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() => exportToJSON(mdnsServices, upnpDevices)}
                    aria-label="Export discovery results"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Export to JSON</TooltipContent>
              </Tooltip>

              {/* Clear Button */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={handleClearResults}
                    aria-label="Clear results"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Clear Results</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Aggregated Device Cards */}
          {filteredDevices.length > 0 && (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {filteredDevices.map((device) => (
                <AggregatedDeviceCard key={device.ipAddress} device={device} />
              ))}
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
            <Button onClick={handleStartDiscovery} disabled={!isConnected} className="min-h-11">
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
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2 text-green-600 dark:text-green-400">
                <Radar className="h-5 w-5" />
                <span className="font-medium">
                  Discovery complete! Found {totalDevices} unique device{totalDevices !== 1 ? "s" : ""}
                  {totalServices !== totalDevices && ` (${totalServices} services)`}.
                </span>
              </div>
              <Button variant="outline" size="sm" onClick={handleStartDiscovery} className="min-h-10">
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
