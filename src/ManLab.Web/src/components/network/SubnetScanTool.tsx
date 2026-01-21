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

import { useState, useCallback, useEffect, useMemo } from "react";
import {
  Search,
  Loader2,
  Download,
  Trash2,
  Copy,
  Radio,
  Route,
  Server,
  Terminal,
  CheckCircle2,
  RefreshCw,
  Filter,
  ArrowUpDown,
  Zap,
  Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
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
import { toast } from "sonner";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import type { DiscoveredHost } from "@/api/networkApi";

// ============================================================================
// Types
// ============================================================================

type SortField = "ip" | "hostname" | "rtt" | "vendor";
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
      h.vendor?.toLowerCase().includes(lowerQuery)
  );
}

/**
 * Export hosts to CSV
 */
function exportToCSV(hosts: DiscoveredHost[]): void {
  const headers = ["IP Address", "Hostname", "MAC Address", "Vendor", "RTT (ms)", "TTL"];
  const rows = hosts.map((h) => [
    h.ipAddress,
    h.hostname || "",
    h.macAddress || "",
    h.vendor || "",
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
  toast.success("Copied to clipboard");
}

/**
 * Get RTT badge color
 */
function getRttBadgeVariant(rtt: number): "default" | "secondary" | "outline" | "destructive" {
  if (rtt < 10) return "default";
  if (rtt < 50) return "secondary";
  if (rtt < 200) return "outline";
  return "destructive";
}

// ============================================================================
// Host Card Component
// ============================================================================

interface HostCardProps {
  host: DiscoveredHost;
  onPing?: (ip: string) => void;
  onTraceroute?: (ip: string) => void;
  onPortScan?: (ip: string) => void;
}

function HostCard({ host, onPing, onTraceroute, onPortScan }: HostCardProps) {
  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            {/* IP Address */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-semibold">
                {host.ipAddress}
              </span>
              <Tooltip>
                <TooltipTrigger>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 w-6 p-0"
                    onClick={() => copyToClipboard(host.ipAddress)}
                  >
                    <Copy className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Copy IP</TooltipContent>
              </Tooltip>
            </div>

            {/* Hostname */}
            {host.hostname && (
              <div className="flex items-center gap-2 text-sm">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="truncate" title={host.hostname}>
                  {host.hostname}
                </span>
              </div>
            )}

            {/* MAC Address & Vendor */}
            {(host.macAddress || host.vendor) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {host.macAddress && (
                  <span className="font-mono">{host.macAddress}</span>
                )}
                {host.vendor && (
                  <Badge variant="outline" className="text-xs">
                    {host.vendor}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* RTT Badge */}
          <div className="flex flex-col items-end gap-2">
            <Badge variant={getRttBadgeVariant(host.roundtripTime)}>
              {host.roundtripTime}ms
            </Badge>
            {host.ttl && (
              <span className="text-xs text-muted-foreground">
                TTL: {host.ttl}
              </span>
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
                onClick={() => onPing?.(host.ipAddress)}
              >
                <Radio className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Ping</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onTraceroute?.(host.ipAddress)}
              >
                <Route className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Traceroute</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => onPortScan?.(host.ipAddress)}
              >
                <Server className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Port Scan</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => window.open(`ssh://${host.ipAddress}`, "_blank")}
              >
                <Terminal className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>SSH</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function SubnetScanTool() {
  // Form state
  const [cidr, setCidr] = useState("");
  const [concurrency, setConcurrency] = useState(100);
  const [timeout, setTimeout] = useState(500);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Scan state
  const [scanState, setScanState] = useState<ScanState>({
    isScanning: false,
    scanId: null,
    progress: 0,
    totalHosts: 0,
    scannedCount: 0,
  });

  // Results state
  const [hosts, setHosts] = useState<DiscoveredHost[]>([]);
  const [filterQuery, setFilterQuery] = useState("");
  const [sortField, setSortField] = useState<SortField>("ip");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // SignalR connection
  const {
    isConnected,
    startSubnetScan,
    subscribeToSubnetScan,
  } = useNetworkHub();

  // Subscribe to scan events
  useEffect(() => {
    const unsubscribe = subscribeToSubnetScan({
      onScanStarted: (event) => {
        setScanState((prev) => ({
          ...prev,
          scanId: event.scanId,
          totalHosts: event.totalHosts,
          isScanning: true,
          progress: 0,
          scannedCount: 0,
        }));
        setHosts([]);
        toast.info(`Scan started: ${event.totalHosts} hosts to check`);
      },
      onScanProgress: (event) => {
        setScanState((prev) => ({
          ...prev,
          progress: event.percentComplete,
          scannedCount: event.scannedCount,
        }));
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
        toast.success(
          `Scan complete: ${event.result.hostsFound} hosts found in ${(event.result.scanDurationMs / 1000).toFixed(1)}s`
        );
      },
      onScanFailed: (event) => {
        setScanState((prev) => ({
          ...prev,
          isScanning: false,
        }));
        toast.error(`Scan failed: ${event.error}`);
      },
    });

    return unsubscribe;
  }, [subscribeToSubnetScan]);

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
      toast.error("Not connected to server. Please wait...");
      return;
    }

    try {
      setScanState((prev) => ({ ...prev, isScanning: true }));
      await startSubnetScan(cidr, concurrency, timeout);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Failed to start scan";
      toast.error(errorMessage);
      setScanState((prev) => ({ ...prev, isScanning: false }));
    }
  }, [cidr, concurrency, timeout, isConnected, startSubnetScan]);

  // Quick scan button - detect subnet from common patterns
  const handleQuickScan = useCallback(() => {
    // Use most common home network
    const defaultSubnet = "192.168.1.0/24";
    setCidr(defaultSubnet);
    setValidationError(null);
    toast.info(`Selected subnet: ${defaultSubnet}`);
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
    toast.info("Results cleared");
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
    const filtered = filterHosts(hosts, filterQuery);
    return sortHosts(filtered, sortField, sortDirection);
  }, [hosts, filterQuery, sortField, sortDirection]);

  // Handle quick actions
  const handlePing = useCallback((ip: string) => {
    toast.info(`Ping ${ip} - switch to Ping tab`);
    // TODO: Integrate with tab switching
  }, []);

  const handleTraceroute = useCallback((ip: string) => {
    toast.info(`Traceroute to ${ip} - switch to Traceroute tab`);
    // TODO: Integrate with tab switching
  }, []);

  const handlePortScan = useCallback((ip: string) => {
    toast.info(`Port scan ${ip} - switch to Port Scan tab`);
    // TODO: Integrate with tab switching
  }, []);

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
                  className={validationError ? "border-destructive" : ""}
                  disabled={scanState.isScanning}
                  list="common-subnets"
                />
                <datalist id="common-subnets">
                  {COMMON_SUBNETS.map((s) => (
                    <option key={s.value} value={s.value} label={s.label} />
                  ))}
                </datalist>
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="outline"
                      size="icon"
                      onClick={handleQuickScan}
                      disabled={scanState.isScanning}
                    >
                      <Zap className="h-4 w-4" />
                    </Button>
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
                className="w-full lg:w-auto"
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
              <Progress value={scanState.progress} className="h-2" />
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

            <div className="flex items-center gap-2">
              {/* Search Filter */}
              <div className="relative">
                <Filter className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Filter hosts..."
                  value={filterQuery}
                  onChange={(e) => setFilterQuery(e.target.value)}
                  className="pl-8 w-[200px]"
                />
              </div>

              {/* Sort Dropdown */}
              <Select
                value={sortField}
                onValueChange={(value) => handleSort(value as SortField)}
              >
                <SelectTrigger className="w-[130px]">
                  <ArrowUpDown className="h-4 w-4 mr-2" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ip">IP Address</SelectItem>
                  <SelectItem value="hostname">Hostname</SelectItem>
                  <SelectItem value="rtt">Response Time</SelectItem>
                  <SelectItem value="vendor">Vendor</SelectItem>
                </SelectContent>
              </Select>

              {/* Export Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger>
                  <Button variant="outline" size="icon">
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
                </DropdownMenuContent>
              </DropdownMenu>

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

          {/* Host Cards Grid */}
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
        </>
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
            <Button variant="outline" onClick={handleQuickScan}>
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
