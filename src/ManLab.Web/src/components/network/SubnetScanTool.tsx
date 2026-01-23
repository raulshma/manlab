/**
 * SubnetScanTool Component
 * Network subnet scanner for discovering hosts on a network.
 * Features:
 * - CIDR input with autocomplete (common subnets)
 * - Concurrency & timeout sliders
 * - Real-time progress bar with percentage
 * - Live host count (X found / Y total)
 * - Streaming host cards as discovered
 * - Filter/sort discovered hosts
 * - Export to CSV/JSON
 * - "Scan My Network" quick button
 */

import { useMemo, useRef, useState, useCallback, useEffect, useLayoutEffect } from "react";
import {
  Search,
  Loader2,
  Download,
  Trash2,
  CheckCircle2,
  RefreshCw,
  Filter,
  ArrowUpDown,
  Zap,
  AlertTriangle,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { ProgressWithEta } from "@/components/network/StatusIndicators";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/network-notify";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import type { DiscoveredHost } from "@/api/networkApi";
import { HostCard } from "@/components/network/HostCard";
import { NetworkMapView } from "@/components/network/NetworkMapView";
import {
  announce,
  announceScanEvent,
  announceProgress,
} from "@/lib/accessibility";

// ============================================================================
// Types
// ============================================================================

type SortField = "ip" | "hostname" | "rtt" | "vendor" | "type";
type SortDirection = "asc" | "desc";

interface ScanState {
  isScanning: boolean;
  scanId: string | null;
  progress: number;
  totalHosts: number;
  scannedCount: number;
}

// ============================================================================
// Constants
// ============================================================================

const COMMON_SUBNETS = [
  { label: "192.168.1.0/24 (Common Home)", value: "192.168.1.0/24" },
  { label: "192.168.0.0/24 (Common Home)", value: "192.168.0.0/24" },
  { label: "10.0.0.0/24 (Internal)", value: "10.0.0.0/24" },
  { label: "172.16.0.0/24 (Private)", value: "172.16.0.0/24" },
  { label: "192.168.1.0/16 (Large Home)", value: "192.168.0.0/16" },
];

const SUBNET_LAST_KEY = "manlab:network:last-subnet";
const SUBNET_CONCURRENCY_KEY = "manlab:network:subnet-concurrency";
const SUBNET_TIMEOUT_KEY = "manlab:network:subnet-timeout";
const SUBNET_SHARE_PREFIX = "manlab:network:subnet-share:";

const VIRTUAL_ITEM_HEIGHT = 190;
const VIRTUAL_OVERSCAN = 4;

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate CIDR notation
 */
function isValidCIDR(cidr: string): boolean {
  const cidrRegex = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
  if (!cidrRegex.test(cidr)) return false;

  const [ip, prefix] = cidr.split("/");
  const parts = ip.split(".");
  const prefixNum = parseInt(prefix, 10);

  // Validate IP octets
  const validIP = parts.every((part) => {
    const num = parseInt(part, 10);
    return num >= 0 && num <= 255;
  });

  // Validate prefix (0-32 for IPv4)
  const validPrefix = prefixNum >= 0 && prefixNum <= 32;

  return validIP && validPrefix;
}

function getCidrPrefix(cidr: string): number | null {
  const parts = cidr.split("/");
  if (parts.length !== 2) return null;
  const prefix = Number(parts[1]);
  return Number.isFinite(prefix) ? prefix : null;
}

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

function saveShareSnapshot(cidr: string, hosts: DiscoveredHost[]): string | null {
  if (typeof window === "undefined") return null;
  const id = crypto.randomUUID();
  const payload = {
    cidr,
    hosts,
    createdAt: new Date().toISOString(),
  };
  localStorage.setItem(`${SUBNET_SHARE_PREFIX}${id}`, JSON.stringify(payload));
  return id;
}

function loadShareSnapshot(id: string): { cidr: string; hosts: DiscoveredHost[] } | null {
  if (typeof window === "undefined") return null;
  const raw = localStorage.getItem(`${SUBNET_SHARE_PREFIX}${id}`);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return { cidr: parsed.cidr, hosts: parsed.hosts };
  } catch {
    return null;
  }
}

/**
 * Parse IP address to number for sorting
 */
function ipToNumber(ip: string): number {
  const parts = ip.split(".").map(Number);
  return parts.reduce((acc, part, i) => acc + part * Math.pow(256, 3 - i), 0);
}

/**
 * Sort hosts by field
 */
function sortHosts(
  hosts: DiscoveredHost[],
  field: SortField,
  direction: SortDirection
): DiscoveredHost[] {
  return [...hosts].sort((a, b) => {
    let comparison = 0;

    switch (field) {
      case "ip":
        comparison = ipToNumber(a.ipAddress) - ipToNumber(b.ipAddress);
        break;
      case "hostname":
        comparison = (a.hostname || "").localeCompare(b.hostname || "");
        break;
      case "rtt":
        comparison = a.roundtripTime - b.roundtripTime;
        break;
      case "vendor":
        comparison = (a.vendor || "").localeCompare(b.vendor || "");
        break;
      case "type":
        comparison = (a.deviceType || "").localeCompare(b.deviceType || "");
        break;
    }

    return direction === "asc" ? comparison : -comparison;
  });
}

/**
 * Filter hosts by search query
 */
function filterHosts(hosts: DiscoveredHost[], query: string): DiscoveredHost[] {
  if (!query) return hosts;
  const lowerQuery = query.toLowerCase();
  return hosts.filter(
    (h) =>
      h.ipAddress.includes(lowerQuery) ||
      h.hostname?.toLowerCase().includes(lowerQuery) ||
      h.macAddress?.toLowerCase().includes(lowerQuery) ||
      h.vendor?.toLowerCase().includes(lowerQuery) ||
      h.deviceType?.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Export hosts to CSV
 */
function exportToCSV(hosts: DiscoveredHost[]): void {
  const headers = [
    "IP Address",
    "Hostname",
    "MAC Address",
    "Vendor",
    "Device Type",
    "RTT (ms)",
    "TTL",
  ];
  const rows = hosts.map((h) => [
    h.ipAddress,
    h.hostname || "",
    h.macAddress || "",
    h.vendor || "",
    h.deviceType || "",
    h.roundtripTime.toString(),
    h.ttl?.toString() || "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `subnet-scan-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Export hosts to JSON
 */
function exportToJSON(hosts: DiscoveredHost[]): void {
  const json = JSON.stringify(hosts, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `subnet-scan-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  notify.success("Copied to clipboard");
}

// ============================================================================
// Main Component
// ============================================================================

export function SubnetScanTool() {
  // Form state
  const [cidr, setCidr] = useState(() => getStoredString(SUBNET_LAST_KEY, ""));
  const [concurrency, setConcurrency] = useState(() => getStoredNumber(SUBNET_CONCURRENCY_KEY, 100));
  const [timeout, setTimeout] = useState(() => getStoredNumber(SUBNET_TIMEOUT_KEY, 500));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

  // Scan state
  const [scanState, setScanState] = useState<ScanState>({
    isScanning: false,
    scanId: null,
    progress: 0,
    totalHosts: 0,
    scannedCount: 0,
  });
  const [etaSeconds, setEtaSeconds] = useState<number | null>(null);
  const scanStartTimeRef = useRef<number | null>(null);

  // Results state
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("ip");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const debouncedFilterQuery = useDebouncedValue(filterQuery, 200);

  const listRef = useRef<HTMLDivElement | null>(null);
  const [listHeight, setListHeight] = useState(600);
  const [scrollTop, setScrollTop] = useState(0);

  // SignalR connection
  const {
    isConnected,
    startSubnetScan,
    subscribeToSubnetScan,
  } = useNetworkHub();

  // Subscribe to scan events
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribeToSubnetScan({
      onScanStarted: (event) => {
        setRateLimitMessage(null);
        setScanState((prev) => ({
          ...prev,
          scanId: event.scanId,
          totalHosts: event.totalHosts,
          isScanning: true,
          progress: 0,
          scannedCount: 0,
        }));
        scanStartTimeRef.current = Date.now();
        setEtaSeconds(null);
        setHosts([]);
        notify.info(`Scan started: ${event.totalHosts} hosts to check`);
        announceScanEvent("started", "Subnet scan", `Checking ${event.totalHosts} hosts`);
      },
      onScanProgress: (event) => {
        setScanState((prev) => ({
          ...prev,
          progress: event.percentComplete,
          scannedCount: event.scannedCount,
        }));
        if (scanStartTimeRef.current && event.percentComplete > 0) {
          const elapsedSeconds = (Date.now() - scanStartTimeRef.current) / 1000;
          const estimatedTotalSeconds = elapsedSeconds / (event.percentComplete / 100);
          const remainingSeconds = Math.max(0, estimatedTotalSeconds - elapsedSeconds);
          setEtaSeconds(Math.round(remainingSeconds));
          // Announce progress at 25% intervals for screen readers
          // Calculate total from scanned count and percentage to avoid stale closure
          const estimatedTotal = event.percentComplete > 0
            ? Math.round(event.scannedCount / (event.percentComplete / 100))
            : event.scannedCount;
          announceProgress(
            event.percentComplete,
            event.scannedCount,
            estimatedTotal,
            "Subnet scan"
          );
        } else {
          setEtaSeconds(null);
        }
      },
      onHostFound: (event) => {
        setHosts((prev) => [...prev, event.host]);
      },
      onScanCompleted: (event) => {
        setScanState((prev) => ({
          ...prev,
          isScanning: false,
          progress: 100,
        }));
        setEtaSeconds(0);
        notify.success(
          `Scan complete: ${event.result.hostsFound} hosts found in ${(event.result.scanDurationMs / 1000).toFixed(1)}s`
        );
        announceScanEvent(
          "completed",
          "Subnet scan",
          `Found ${event.result.hostsFound} hosts`
        );
      },
      onScanFailed: (event) => {
        setScanState((prev) => ({
          ...prev,
          isScanning: false,
        }));
        setEtaSeconds(null);
        scanStartTimeRef.current = null;
        if (event.error.toLowerCase().includes("rate") || event.error.includes("429")) {
          setRateLimitMessage("Rate limit reached. Please wait a moment before retrying.");
        }
        notify.error(`Scan failed: ${event.error}`);
        announceScanEvent("failed", "Subnet scan", event.error);
      },
    });

    return unsubscribe;
  }, [isConnected, subscribeToSubnetScan]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(SUBNET_LAST_KEY, cidr);
    localStorage.setItem(SUBNET_CONCURRENCY_KEY, String(concurrency));
    localStorage.setItem(SUBNET_TIMEOUT_KEY, String(timeout));
  }, [cidr, concurrency, timeout]);

  // Load shared snapshot on mount - using useLayoutEffect to avoid cascading renders
  // This runs synchronously before paint, so setState is acceptable here
  useLayoutEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const shareId = params.get("share");
    if (!shareId) return;
    const snapshot = loadShareSnapshot(shareId);
    if (!snapshot) return;

    // Batch state updates - these are intentional for initial data loading
    /* eslint-disable react-hooks/set-state-in-effect */
    setCidr(snapshot.cidr);
    setHosts(snapshot.hosts);
    setScanState({
      isScanning: false,
      scanId: null,
      progress: 100,
      totalHosts: snapshot.hosts.length,
      scannedCount: snapshot.hosts.length,
    });
    /* eslint-enable react-hooks/set-state-in-effect */
    notify.info("Loaded shared subnet scan results.");
  }, []);



  // Handle input change with validation
  const handleCidrChange = useCallback((value: string) => {
    setCidr(value);
    if (value && !isValidCIDR(value)) {
      setValidationError("Please enter a valid CIDR notation (e.g., 192.168.1.0/24)");
    } else {
      setValidationError(null);
    }
  }, []);

  // Start scan
  const handleStartScan = useCallback(async () => {
    if (!cidr || !isValidCIDR(cidr)) {
      setValidationError("Please enter a valid CIDR notation");
      return;
    }

    if (!isConnected) {
      notify.error("Not connected to server. Please wait...");
      return;
    }

    const prefix = getCidrPrefix(cidr);
    if (prefix !== null && prefix <= 20) {
      const confirmed = window.confirm(
        "This is a large subnet scan and may take several minutes. Continue?"
      );
      if (!confirmed) return;
    }

    try {
      setRateLimitMessage(null);
      setScanState((prev) => ({ ...prev, isScanning: true }));
      await startSubnetScan(cidr, concurrency, timeout);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start scan";
      if (errorMessage.toLowerCase().includes("rate") || errorMessage.includes("429")) {
        setRateLimitMessage("Rate limit reached. Please wait a moment before retrying.");
      }
      notify.error(errorMessage);
      setScanState((prev) => ({ ...prev, isScanning: false }));
    }
  }, [cidr, concurrency, timeout, isConnected, startSubnetScan]);

  // Quick scan button - detect subnet from common patterns
  const handleQuickScan = useCallback(() => {
    // Use most common home network
    const defaultSubnet = "192.168.1.0/24";
    setCidr(defaultSubnet);
    setValidationError(null);
    notify.info(`Selected subnet: ${defaultSubnet}`);
  }, []);

  // Clear results
  const handleClearResults = useCallback(() => {
    setHosts([]);
    setScanState({
      isScanning: false,
      scanId: null,
      progress: 0,
      totalHosts: 0,
      scannedCount: 0,
    });
    scanStartTimeRef.current = null;
    // Assuming 'announce' is imported from the same place as announceScanEvent and announceProgress
    // For example: import { announce, announceScanEvent, announceProgress } from "@/lib/accessibility-utils";
    announce("Results cleared", "polite");
    setEtaSeconds(null);
    notify.info("Results cleared");
  }, []);

  // Toggle sort direction
  const handleSort = useCallback((field: SortField) => {
    setSortField((prev) => {
      if (prev === field) {
        setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDirection("asc");
      return field;
    });
  }, []);

  // Filtered and sorted hosts
  const displayedHosts = useMemo(() => {
    const filtered = filterHosts(hosts, debouncedFilterQuery);
    return sortHosts(filtered, sortField, sortDirection);
  }, [hosts, debouncedFilterQuery, sortField, sortDirection]);

  const shouldVirtualize = displayedHosts.length > 200;
  const totalHeight = displayedHosts.length * VIRTUAL_ITEM_HEIGHT;
  const startIndex = Math.max(
    0,
    Math.floor(scrollTop / VIRTUAL_ITEM_HEIGHT) - VIRTUAL_OVERSCAN
  );
  const endIndex = Math.min(
    displayedHosts.length,
    Math.ceil((scrollTop + listHeight) / VIRTUAL_ITEM_HEIGHT) + VIRTUAL_OVERSCAN
  );
  const visibleHosts = displayedHosts.slice(startIndex, endIndex);

  // Update list height when element resizes using ResizeObserver
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const height = entry.contentRect.height || 600;
        setListHeight(height);
      }
    });

    resizeObserver.observe(element);
    // Set initial height - necessary for first render before ResizeObserver fires
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListHeight(element.clientHeight || 600);

    return () => resizeObserver.disconnect();
  }, []); // Empty deps - observer handles updates

  // Handle quick actions
  const handlePing = useCallback((ip: string) => {
    notify.info(`Ping ${ip} - switch to Ping tab`);
    // TODO: Integrate with tab switching
  }, []);

  const handleTraceroute = useCallback((ip: string) => {
    notify.info(`Traceroute to ${ip} - switch to Traceroute tab`);
    // TODO: Integrate with tab switching
  }, []);

  const handlePortScan = useCallback((ip: string) => {
    notify.info(`Port scan ${ip} - switch to Port Scan tab`);
    // TODO: Integrate with tab switching
  }, []);

  const handleShareResults = useCallback(async () => {
    if (displayedHosts.length === 0) {
      notify.error("No data to share");
      return;
    }
    const shareId = saveShareSnapshot(cidr, displayedHosts);
    if (!shareId) return;
    const shareUrl = `${window.location.origin}/network?share=${shareId}`;
    await navigator.clipboard.writeText(shareUrl);
    notify.success("Share link copied to clipboard");
  }, [cidr, displayedHosts]);

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Search className="h-5 w-5" />
            Subnet Scanner
          </CardTitle>
          <CardDescription>
            Discover all active hosts on your network using ICMP ping sweep
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 lg:grid-cols-[1fr_150px_150px_auto]">
            {/* CIDR Input */}
            <div className="space-y-2">
              <Label htmlFor="subnet-cidr">Subnet (CIDR Notation)</Label>
              <div className="flex gap-2">
                <Input
                  id="subnet-cidr"
                  placeholder="e.g., 192.168.1.0/24"
                  value={cidr}
                  onChange={(e) => handleCidrChange(e.target.value)}
                  className={validationError ? "border-destructive flex-1" : "flex-1"}
                  disabled={scanState.isScanning}
                  list="common-subnets"
                />
                <datalist id="common-subnets">
                  {COMMON_SUBNETS.map((s) => (
                    <option key={s.value} value={s.value} label={s.label} />
                  ))}
                </datalist>
                <Tooltip>
                  <TooltipTrigger
                    className={buttonVariants({ variant: "outline", size: "icon" }) + " h-11 w-11"}
                    onClick={handleQuickScan}
                    disabled={scanState.isScanning}
                    aria-label="Scan my network"
                  >
                    <Zap className="h-4 w-4" />
                  </TooltipTrigger>
                  <TooltipContent>Scan My Network</TooltipContent>
                </Tooltip>
              </div>
              {validationError && (
                <p className="text-sm text-destructive">{validationError}</p>
              )}
            </div>

            {/* Concurrency Slider */}
            <div className="space-y-2">
              <Label>Concurrency: {concurrency}</Label>
              <Slider
                value={[concurrency]}
                onValueChange={(value) => {
                  const newValue = Array.isArray(value) ? value[0] : value;
                  setConcurrency(newValue);
                }}
                min={10}
                max={500}
                step={10}
                disabled={scanState.isScanning}
                className="mt-3"
              />
              <p className="text-xs text-muted-foreground">Parallel pings</p>
            </div>

            {/* Timeout Slider */}
            <div className="space-y-2">
              <Label>Timeout: {timeout}ms</Label>
              <Slider
                value={[timeout]}
                onValueChange={(value) => {
                  const newValue = Array.isArray(value) ? value[0] : value;
                  setTimeout(newValue);
                }}
                min={100}
                max={2000}
                step={100}
                disabled={scanState.isScanning}
                className="mt-3"
              />
              <p className="text-xs text-muted-foreground">Per-host timeout</p>
            </div>

            {/* Submit Button */}
            <div className="flex items-end">
              <Button
                onClick={handleStartScan}
                disabled={scanState.isScanning || !cidr || !isConnected}
                className="w-full lg:w-auto min-h-11"
              >
                {scanState.isScanning ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" />
                    Start Scan
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

          {rateLimitMessage && (
            <div className="mt-4 p-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-orange-600 dark:text-orange-400 text-sm flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              {rateLimitMessage}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Progress Section */}
      {scanState.isScanning && (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Scanning progress</span>
                <span className="font-medium">
                  {scanState.scannedCount} / {scanState.totalHosts} hosts checked
                </span>
              </div>
              <ProgressWithEta
                value={scanState.progress}
                scanned={scanState.scannedCount}
                total={scanState.totalHosts}
                etaSeconds={etaSeconds}
              />
              <div className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2 text-green-500">
                  <CheckCircle2 className="h-4 w-4" />
                  {hosts.length} hosts found
                </span>
                <span className="text-muted-foreground">
                  {scanState.progress.toFixed(1)}% complete
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {scanState.isScanning && hosts.length === 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={index} className="h-36" />
          ))}
        </div>
      )}

      {/* Results Section */}
      {hosts.length > 0 && (
        <>
          {/* Results Header */}
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <h3 className="text-lg font-medium">
                Discovered Hosts ({displayedHosts.length})
              </h3>
              {filterQuery && displayedHosts.length !== hosts.length && (
                <Badge variant="secondary">
                  Showing {displayedHosts.length} of {hosts.length}
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Search Filter */}
              <div className="relative">
                <Filter className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter hosts..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="pl-8 w-50"
                />
              </div>

              {/* Sort Dropdown */}
              <Select
                value={sortField}
                onValueChange={(value) => handleSort(value as SortField)}
              >
                <SelectTrigger className="w-32.5">
                  <ArrowUpDown className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ip">IP Address</SelectItem>
                  <SelectItem value="hostname">Hostname</SelectItem>
                  <SelectItem value="rtt">Response Time</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                  <SelectItem value="type">Device Type</SelectItem>
                </SelectContent>
              </Select>

              {/* Export Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button variant="outline" size="icon" aria-label="Export results">
                    <Download className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => exportToCSV(displayedHosts)}>
                    Export as CSV
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => exportToJSON(displayedHosts)}>
                    Export as JSON
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onClick={() =>
                      copyToClipboard(displayedHosts.map((h) => h.ipAddress).join("\n"))
                    }
                  >
                    Copy all IPs
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleShareResults}>
                    Copy share link
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              {/* Clear Button */}
              <Tooltip>
                <TooltipTrigger
                  className={buttonVariants({ variant: "outline", size: "icon" })}
                  onClick={handleClearResults}
                  aria-label="Clear results"
                >
                  <Trash2 className="h-4 w-4" />
                </TooltipTrigger>
                <TooltipContent>Clear Results</TooltipContent>
              </Tooltip>
            </div>
          </div>

          {/* Host Cards */}
          {shouldVirtualize ? (
            <div
              ref={listRef}
              onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
              className="max-h-168 overflow-auto rounded-lg border"
            >
              <div style={{ height: totalHeight, position: "relative" }}>
                {visibleHosts.map((host, index) => (
                  <div
                    key={host.ipAddress}
                    style={{
                      position: "absolute",
                      left: 0,
                      right: 0,
                      top: (startIndex + index) * VIRTUAL_ITEM_HEIGHT,
                      padding: "0.5rem",
                    }}
                  >
                    <HostCard
                      host={host}
                      onPing={handlePing}
                      onTraceroute={handleTraceroute}
                      onPortScan={handlePortScan}
                    />
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {displayedHosts.map((host) => (
                <HostCard
                  key={host.ipAddress}
                  host={host}
                  onPing={handlePing}
                  onTraceroute={handleTraceroute}
                  onPortScan={handlePortScan}
                />
              ))}
            </div>
          )}
        </>
      )}

      {!scanState.isScanning && hosts.length > 0 && (
        <NetworkMapView hosts={hosts} />
      )}

      {/* Empty State */}
      {!scanState.isScanning && hosts.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Search className="h-12 w-12 mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No hosts discovered yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm mb-4">
              Enter a CIDR subnet range (e.g., 192.168.1.0/24) and click "Start Scan"
              to discover all active hosts on your network.
            </p>
            <Button variant="outline" onClick={handleQuickScan} className="min-h-11">
              <Zap className="mr-2 h-4 w-4" />
              Scan My Network (192.168.1.0/24)
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Scan Complete Summary */}
      {!scanState.isScanning && hosts.length > 0 && scanState.progress === 100 && (
        <Card className="border-green-500/30 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <CheckCircle2 className="h-8 w-8 text-green-500" />
              <div>
                <h4 className="font-medium">Scan Complete</h4>
                <p className="text-sm text-muted-foreground">
                  Found {hosts.length} active hosts on {cidr}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
