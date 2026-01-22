/**
 * PortScanTool Component
 * Network port scanner for identifying open ports and services on a host.
 * Features:
 * - Target host input with validation
 * - Port range selection (Common Ports / Custom Range / Specific Ports)
 * - Quick Scan presets (Web Server, Database, File Server, etc.)
 * - Concurrency & timeout sliders
 * - Progress bar showing ports scanned
 * - Live "Open Port" cards as discovered
 * - Group by service type
 * - Color-coded risk indicators
 * - Test connection button for web ports
 * - Real-time updates via SignalR
 */

import { lazy, Suspense, useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  Server,
  Loader2,
  Download,
  Trash2,
  CheckCircle2,
  Clock,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Globe,
  Database,
  HardDrive,
  Terminal,
  Mail,
  Monitor,
  Zap,
  Copy,
  Filter,
  LayoutGrid,
  List,
  AlertTriangle,
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
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { notify } from "@/lib/network-notify";
import {
  scanPorts as scanPortsApi,
  type PortScanResult,
  type OpenPort,
} from "@/api/networkApi";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { PortCard } from "@/components/network/PortCard";
import { CategoryIcon } from "@/components/network/CategoryIcon";
import {
  getPortInfo,
  getRiskColor,
  type RiskLevel,
  type ServiceCategory,
  ALL_COMMON_PORTS,
} from "@/components/network/port-constants";
import { announce, announceScanEvent } from "@/lib/accessibility";
const PortDistributionChart = lazy(
  () => import("@/components/network/PortDistributionChart")
);

// ============================================================================
// Types & Constants
// ============================================================================

type PortMode = "common" | "custom" | "specific";

interface QuickScanPreset {
  name: string;
  description: string;
  ports: number[];
  icon: React.ComponentType<{ className?: string }>;
}

const PORT_HOST_KEY = "manlab:network:port-host";
const PORT_CONCURRENCY_KEY = "manlab:network:port-concurrency";
const PORT_TIMEOUT_KEY = "manlab:network:port-timeout";

// Quick scan presets
const QUICK_SCAN_PRESETS: QuickScanPreset[] = [
  {
    name: "Web Server",
    description: "HTTP, HTTPS, and common web ports",
    ports: [80, 443, 8080, 8443, 3000, 4000, 5000],
    icon: Globe,
  },
  {
    name: "Database",
    description: "Common database ports",
    ports: [1433, 1521, 3306, 5432, 6379, 27017],
    icon: Database,
  },
  {
    name: "Remote Access",
    description: "SSH, RDP, VNC, and Telnet",
    ports: [22, 23, 3389, 5900],
    icon: Terminal,
  },
  {
    name: "File Server",
    description: "FTP, SMB, and file sharing",
    ports: [21, 139, 445, 2049],
    icon: HardDrive,
  },
  {
    name: "Mail Server",
    description: "SMTP, POP3, and IMAP ports",
    ports: [25, 110, 143, 465, 587, 993, 995],
    icon: Mail,
  },
  {
    name: "Full Scan",
    description: "All common ports (25 ports)",
    ports: ALL_COMMON_PORTS,
    icon: Monitor,
  },
];

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Validate hostname/IP address format
 */
function isValidHost(host: string): boolean {
  if (!host || host.trim().length === 0) return false;

  // Check for valid IP address (IPv4)
  const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
  if (ipv4Regex.test(host)) {
    const parts = host.split(".");
    return parts.every((part) => {
      const num = parseInt(part, 10);
      return num >= 0 && num <= 255;
    });
  }

  // Check for valid hostname
  const hostnameRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  return hostnameRegex.test(host);
}

/**
 * Parse port range string (e.g., "1-1000", "22,80,443")
 */
function parsePortsString(input: string): number[] {
  const ports: number[] = [];
  const parts = input.split(",").map((s) => s.trim());

  for (const part of parts) {
    if (part.includes("-")) {
      const [start, end] = part.split("-").map((s) => parseInt(s.trim(), 10));
      if (!isNaN(start) && !isNaN(end) && start > 0 && end <= 65535 && start <= end) {
        for (let i = start; i <= Math.min(end, start + 1000); i++) {
          ports.push(i);
        }
      }
    } else {
      const port = parseInt(part, 10);
      if (!isNaN(port) && port > 0 && port <= 65535) {
        ports.push(port);
      }
    }
  }

  return [...new Set(ports)].sort((a, b) => a - b);
}

function validateCustomRange(startStr: string, endStr: string): string | null {
  if (!startStr && !endStr) return null;
  const start = parseInt(startStr, 10);
  const end = parseInt(endStr, 10);

  if (!Number.isFinite(start) || !Number.isFinite(end)) {
    return "Enter valid numeric start and end ports.";
  }

  if (start < 1 || end > 65535) {
    return "Ports must be between 1 and 65535.";
  }

  if (end < start) {
    return "End port must be greater than or equal to start port.";
  }

  return null;
}

function validateSpecificPorts(input: string): string | null {
  if (!input.trim()) return null;
  const parsed = parsePortsString(input);
  if (parsed.length === 0) {
    return "Enter ports like '22, 80, 443' or ranges like '3000-3010'.";
  }
  return null;
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

/**
 * Copy text to clipboard
 */
async function copyToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify.success("Copied to clipboard");
  } catch {
    notify.error("Failed to copy to clipboard");
  }
}

/**
 * Export port scan results to CSV
 */
function exportToCSV(result: PortScanResult): void {
  const headers = ["Port", "Service", "Description", "Category", "Risk"];
  const rows = result.openPorts.map((port) => {
    const info = getPortInfo(port);
    return [
      port.port.toString(),
      info.serviceName || "",
      info.serviceDescription || "",
      info.category,
      info.risk,
    ];
  });

  const csvContent = [
    `# Port Scan Results for ${result.host}${result.resolvedAddress ? ` (${result.resolvedAddress})` : ""}`,
    `# Open Ports: ${result.openPorts.length} / ${result.scannedPorts} scanned`,
    `# Scan Duration: ${result.scanDurationMs}ms`,
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `port-scan-${result.host}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Export port scan results to JSON
 */
function exportToJSON(result: PortScanResult): void {
  const payload = {
    host: result.host,
    resolvedAddress: result.resolvedAddress,
    scannedPorts: result.scannedPorts,
    scanDurationMs: result.scanDurationMs,
    openPorts: result.openPorts.map((port) => ({
      ...port,
      metadata: getPortInfo(port),
    })),
    exportedAt: new Date().toISOString(),
  };

  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `port-scan-${result.host}-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ============================================================================
// Main Component
// ============================================================================

export function PortScanTool() {
  // Form state
  const [host, setHost] = useState(() => getStoredString(PORT_HOST_KEY, ""));
  const [portMode, setPortMode] = useState<PortMode>("common");
  const [customRangeStart, setCustomRangeStart] = useState("1");
  const [customRangeEnd, setCustomRangeEnd] = useState("1000");
  const [specificPorts, setSpecificPorts] = useState("");
  const [concurrency, setConcurrency] = useState(() => getStoredNumber(PORT_CONCURRENCY_KEY, 50));
  const [timeout, setTimeout] = useState(() => getStoredNumber(PORT_TIMEOUT_KEY, 2000));
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [portValidationError, setPortValidationError] = useState<string | null>(null);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

  // Result state
  const [result, setResult] = useState<PortScanResult | null>(null);
  const [liveOpenPorts, setLiveOpenPorts] = useState<OpenPort[]>([]);
  const [scanProgress, setScanProgress] = useState(0);
  const [isScanning, setIsScanning] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Filter/View state
  const [categoryFilter, setCategoryFilter] = useState<ServiceCategory | "all">("all");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // SignalR
  const { isConnected, subscribeToPortScan, scanPorts: hubScanPorts } =
    useNetworkHub();

  // Input ref for focus
  const inputRef = useRef<HTMLInputElement>(null);

  // Get ports based on mode
  const getPortsToScan = useCallback((): number[] => {
    switch (portMode) {
      case "common":
        return ALL_COMMON_PORTS;
      case "custom": {
        const start = parseInt(customRangeStart, 10) || 1;
        const end = parseInt(customRangeEnd, 10) || 1000;
        const ports: number[] = [];
        for (let i = Math.max(1, start); i <= Math.min(65535, end, start + 1000); i++) {
          ports.push(i);
        }
        return ports;
      }
      case "specific":
        return parsePortsString(specificPorts);
    }
  }, [portMode, customRangeStart, customRangeEnd, specificPorts]);

  // Subscribe to port scan events
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribeToPortScan({
      onPortScanStarted: (event) => {
        console.log("Port scan started:", event);
        setRateLimitMessage(null);
        setLiveOpenPorts([]);
        setIsScanning(true);
        setScanProgress(0);
      },
      onPortFound: (event) => {
        console.log("Port found:", event);
        setLiveOpenPorts((prev) => [...prev, event.port]);
      },
      onPortScanCompleted: (event) => {
        console.log("Port scan completed:", event);
        setResult(event.result);
        setLiveOpenPorts([]);
        setIsScanning(false);
        setScanProgress(100);
      },
    });

    return unsubscribe;
  }, [isConnected, subscribeToPortScan]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(PORT_HOST_KEY, host);
    localStorage.setItem(PORT_CONCURRENCY_KEY, String(concurrency));
    localStorage.setItem(PORT_TIMEOUT_KEY, String(timeout));
  }, [host, concurrency, timeout]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (portMode === "custom") {
      setPortValidationError(validateCustomRange(customRangeStart, customRangeEnd));
      return;
    }

    if (portMode === "specific") {
      setPortValidationError(validateSpecificPorts(specificPorts));
      return;
    }

    setPortValidationError(null);
  }, [portMode, customRangeStart, customRangeEnd, specificPorts]);

  // Handle input change with validation
  const handleHostChange = useCallback((value: string) => {
    setHost(value);
    if (value && !isValidHost(value)) {
      setValidationError("Please enter a valid hostname or IP address");
    } else {
      setValidationError(null);
    }
  }, []);

  // Handle quick scan preset selection
  const handleQuickScan = useCallback(
    (preset: QuickScanPreset) => {
      setPortMode("specific");
      setSpecificPorts(preset.ports.join(", "));
      notify.info(`Selected ${preset.name} preset: ${preset.ports.length} ports`);
    },
    []
  );

  // Handle port scan submission
  const handleScan = useCallback(async () => {
    if (!host || !isValidHost(host)) {
      setValidationError("Please enter a valid hostname or IP address");
      inputRef.current?.focus();
      return;
    }

    if (portValidationError) {
      notify.error(portValidationError);
      return;
    }

    const ports = getPortsToScan();
    if (ports.length === 0) {
      notify.error("No valid ports to scan");
      return;
    }

    if (ports.length > 1000) {
      notify.warning("Port range limited to 1000 ports for performance");
    }

    if (ports.length > 500) {
      const confirmed = window.confirm(
        `This will scan ${ports.length} ports and may take a while. Continue?`
      );
      if (!confirmed) return;
    }

    setIsLoading(true);
    setValidationError(null);
    setRateLimitMessage(null);
    setResult(null);
    setLiveOpenPorts([]);
    setScanProgress(0);

    try {
      // Try SignalR first for real-time updates
      if (isConnected) {
        setIsScanning(true);
        const scanResult = await hubScanPorts(host, ports, concurrency, timeout);
        setResult(scanResult);
        setIsScanning(false);

        notify.success(
          `Scan complete: ${scanResult.openPorts.length} open ports found out of ${scanResult.scannedPorts} scanned`
        );
        announceScanEvent(
          "completed",
          "Port scan",
          `Found ${scanResult.openPorts.length} open ports`
        );
      } else {
        // Fallback to REST API
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const scanResult = await scanPortsApi(
          {
            host,
            ports,
            concurrencyLimit: concurrency,
            timeout,
          },
          { signal: controller.signal }
        );
        setResult(scanResult);

        notify.success(
          `Scan complete: ${scanResult.openPorts.length} open ports found out of ${scanResult.scannedPorts} scanned`
        );
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Port scan failed";
      if (errorMessage.toLowerCase().includes("rate") || errorMessage.includes("429")) {
        setRateLimitMessage("Rate limit reached. Please wait before retrying.");
      }
      notify.error(errorMessage);
      setResult(null);
      setIsScanning(false);
    } finally {
      setIsLoading(false);
    }
  }, [host, portValidationError, getPortsToScan, concurrency, timeout, isConnected, hubScanPorts]);

  // Handle Enter key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isLoading) {
        handleScan();
      }
    },
    [handleScan, isLoading]
  );

  // Clear results
  const handleClear = useCallback(() => {
    setResult(null);
    setLiveOpenPorts([]);
    setScanProgress(0);
    notify.info("Results cleared");
    announce("Port scan results cleared", "polite");
  }, []);

  // Export to CSV
  const handleExportCsv = useCallback(() => {
    if (!result) {
      notify.error("No data to export");
      return;
    }
    exportToCSV(result);
    notify.success("Exported to CSV");
  }, [result]);

  const handleExportJson = useCallback(() => {
    if (!result) {
      notify.error("No data to export");
      return;
    }
    exportToJSON(result);
    notify.success("Exported to JSON");
  }, [result]);

  // Determine which ports to display
  const displayPorts = useMemo(() => {
    const ports = isScanning && liveOpenPorts.length > 0 ? liveOpenPorts : result?.openPorts || [];

    if (categoryFilter === "all") {
      return ports;
    }

    return ports.filter((port) => {
      const info = getPortInfo(port);
      return info.category === categoryFilter;
    });
  }, [isScanning, liveOpenPorts, result, categoryFilter]);

  // Group ports by category
  const portsByCategory = useMemo(() => {
    const groups: Record<ServiceCategory, OpenPort[]> = {
      web: [],
      database: [],
      remote: [],
      mail: [],
      file: [],
      other: [],
    };

    const ports = isScanning && liveOpenPorts.length > 0 ? liveOpenPorts : result?.openPorts || [];
    ports.forEach((port) => {
      const info = getPortInfo(port);
      groups[info.category].push(port);
    });

    return groups;
  }, [isScanning, liveOpenPorts, result]);

  // Calculate statistics
  const stats = useMemo(() => {
    const ports = result?.openPorts || liveOpenPorts;
    const byRisk: Record<RiskLevel, number> = { low: 0, medium: 0, high: 0, critical: 0 };

    ports.forEach((port) => {
      const info = getPortInfo(port);
      byRisk[info.risk]++;
    });

    return {
      total: ports.length,
      byRisk,
      hasHighRisk: byRisk.high > 0 || byRisk.critical > 0,
    };
  }, [result, liveOpenPorts]);

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Server className="h-5 w-5" />
            Port Scanner
          </CardTitle>
          <CardDescription>
            Scan for open ports and identify running services on a host
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Host Input Row */}
          <div className="grid gap-6 md:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="port-scan-host">Target Host</Label>
              <Input
                id="port-scan-host"
                ref={inputRef}
                placeholder="e.g., example.com or 192.168.1.1"
                value={host}
                onChange={(e) => handleHostChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className={validationError ? "border-destructive" : ""}
                disabled={isLoading}
                aria-invalid={!!validationError}
                aria-describedby={validationError ? "port-scan-host-error" : undefined}
              />
              {validationError && (
                <p id="port-scan-host-error" className="text-sm text-destructive" role="alert">
                  {validationError}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <div className="flex items-end">
              <Button
                onClick={handleScan}
                disabled={isLoading || !host}
                className="w-full md:w-auto min-h-11"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Scanning...
                  </>
                ) : (
                  <>
                    <Zap className="mr-2 h-4 w-4" />
                    Scan Ports
                  </>
                )}
              </Button>
            </div>
          </div>

          {/* Port Selection */}
          <div className="space-y-4">
            <Label>Port Selection</Label>
            <RadioGroup
              value={portMode}
              onValueChange={(value) => setPortMode(value as PortMode)}
              className="grid gap-4 md:grid-cols-3"
            >
              <div>
                <RadioGroupItem value="common" id="common" className="peer sr-only" />
                <Label
                  htmlFor="common"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                >
                  <Server className="mb-2 h-6 w-6" />
                  <span className="text-sm font-medium">Common Ports</span>
                  <span className="text-xs text-muted-foreground">
                    {ALL_COMMON_PORTS.length} well-known ports
                  </span>
                </Label>
              </div>

              <div>
                <RadioGroupItem value="custom" id="custom" className="peer sr-only" />
                <Label
                  htmlFor="custom"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                >
                  <LayoutGrid className="mb-2 h-6 w-6" />
                  <span className="text-sm font-medium">Custom Range</span>
                  <span className="text-xs text-muted-foreground">
                    Specify start-end range
                  </span>
                </Label>
              </div>

              <div>
                <RadioGroupItem value="specific" id="specific" className="peer sr-only" />
                <Label
                  htmlFor="specific"
                  className="flex flex-col items-center justify-between rounded-md border-2 border-muted bg-popover p-4 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary [&:has([data-state=checked])]:border-primary cursor-pointer"
                >
                  <List className="mb-2 h-6 w-6" />
                  <span className="text-sm font-medium">Specific Ports</span>
                  <span className="text-xs text-muted-foreground">
                    Comma-separated list
                  </span>
                </Label>
              </div>
            </RadioGroup>

            {/* Custom Range Inputs */}
            {portMode === "custom" && (
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="range-start">Start Port</Label>
                  <Input
                    id="range-start"
                    type="number"
                    min={1}
                    max={65535}
                    value={customRangeStart}
                    onChange={(e) => setCustomRangeStart(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="range-end">End Port</Label>
                  <Input
                    id="range-end"
                    type="number"
                    min={1}
                    max={65535}
                    value={customRangeEnd}
                    onChange={(e) => setCustomRangeEnd(e.target.value)}
                    disabled={isLoading}
                  />
                </div>
                {portValidationError ? (
                  <p className="text-xs text-destructive col-span-2">
                    {portValidationError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground col-span-2">
                    Maximum range: 1000 ports. Currently scanning:{" "}
                    {Math.min(
                      1000,
                      Math.max(
                        0,
                        (parseInt(customRangeEnd) || 0) - (parseInt(customRangeStart) || 0) + 1
                      )
                    )}{" "}
                    ports
                  </p>
                )}
              </div>
            )}

            {/* Specific Ports Input */}
            {portMode === "specific" && (
              <div className="space-y-2">
                <Label htmlFor="specific-ports">Ports (comma-separated)</Label>
                <Input
                  id="specific-ports"
                  placeholder="e.g., 22, 80, 443, 3000-3010"
                  value={specificPorts}
                  onChange={(e) => setSpecificPorts(e.target.value)}
                  disabled={isLoading}
                />
                {portValidationError ? (
                  <p className="text-xs text-destructive">
                    {portValidationError}
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    You can use ranges like "1-100" or specific ports like "22, 80, 443".
                    Currently: {parsePortsString(specificPorts).length} ports
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Quick Scan Presets */}
          <div className="space-y-3">
            <Label>Quick Scan Presets</Label>
            <div className="grid gap-2 grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              {QUICK_SCAN_PRESETS.map((preset) => {
                const Icon = preset.icon;
                return (
                  <Button
                    key={preset.name}
                    variant="outline"
                    size="sm"
                    onClick={() => handleQuickScan(preset)}
                    disabled={isLoading}
                    className="flex-col h-auto py-3 gap-1 min-h-14"
                  >
                    <Icon className="h-5 w-5" />
                    <span className="text-xs">{preset.name}</span>
                  </Button>
                );
              })}
            </div>
          </div>

          {/* Concurrency & Timeout Sliders */}
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label>Concurrency: {concurrency}</Label>
              <Slider
                value={[concurrency]}
                onValueChange={(value) => {
                  const newValue = Array.isArray(value) ? value[0] : value;
                  setConcurrency(newValue);
                }}
                min={10}
                max={200}
                step={10}
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Parallel connections (10-200)
              </p>
            </div>

            <div className="space-y-2">
              <Label>Timeout: {timeout}ms</Label>
              <Slider
                value={[timeout]}
                onValueChange={(value) => {
                  const newValue = Array.isArray(value) ? value[0] : value;
                  setTimeout(newValue);
                }}
                min={500}
                max={10000}
                step={500}
                disabled={isLoading}
              />
              <p className="text-xs text-muted-foreground">
                Connection timeout (500ms - 10s)
              </p>
            </div>
          </div>
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

      {/* Live Progress Indicator */}
      {isScanning && (
        <Card className="border-primary/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">
                  Scanning ports on {host}...
                </p>
                <p className="text-sm text-muted-foreground">
                  {liveOpenPorts.length} open ports found
                </p>
              </div>
              <Progress value={scanProgress} className="w-32" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result Summary */}
      {(result || liveOpenPorts.length > 0) && (
        <Card
          className={`border-l-4 ${stats.hasHighRisk ? "border-l-orange-500" : "border-l-green-500"}`}
        >
          <CardContent className="pt-6">
            <div className="grid gap-4 md:grid-cols-5">
              {/* Status */}
              <div className="flex items-center gap-3">
                {stats.hasHighRisk ? (
                  <ShieldAlert className="h-8 w-8 text-orange-500" />
                ) : (
                  <ShieldCheck className="h-8 w-8 text-green-500" />
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge
                    variant={stats.hasHighRisk ? "destructive" : "default"}
                    className={stats.hasHighRisk ? "" : "bg-green-500"}
                  >
                    {stats.hasHighRisk ? "Attention Needed" : "Secure"}
                  </Badge>
                </div>
              </div>

              {/* Open Ports */}
              <div className="flex items-center gap-3">
                <Server className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Open Ports</p>
                  <p className="text-2xl font-bold">{stats.total}</p>
                </div>
              </div>

              {/* Scanned */}
              {result && (
                <div className="flex items-center gap-3">
                  <Zap className="h-8 w-8 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Scanned</p>
                    <p className="text-2xl font-bold">{result.scannedPorts}</p>
                  </div>
                </div>
              )}

              {/* Duration */}
              {result && (
                <div className="flex items-center gap-3">
                  <Clock className="h-8 w-8 text-primary" />
                  <div>
                    <p className="text-sm text-muted-foreground">Duration</p>
                    <p className="text-2xl font-bold">
                      {(result.scanDurationMs / 1000).toFixed(1)}s
                    </p>
                  </div>
                </div>
              )}

              {/* Risk Summary */}
              <div className="flex items-center gap-3">
                <Shield className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Risk Breakdown</p>
                  <div className="flex gap-2 text-xs">
                    {stats.byRisk.critical > 0 && (
                      <Badge variant="outline" className="text-red-500">
                        {stats.byRisk.critical} Critical
                      </Badge>
                    )}
                    {stats.byRisk.high > 0 && (
                      <Badge variant="outline" className="text-orange-500">
                        {stats.byRisk.high} High
                      </Badge>
                    )}
                    {stats.byRisk.medium > 0 && (
                      <Badge variant="outline" className="text-yellow-500">
                        {stats.byRisk.medium} Med
                      </Badge>
                    )}
                    {stats.byRisk.low > 0 && (
                      <Badge variant="outline" className="text-green-500">
                        {stats.byRisk.low} Low
                      </Badge>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {/* Resolved Address */}
            {result?.resolvedAddress && result.resolvedAddress !== result.host && (
              <div className="mt-4 pt-4 border-t flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Resolved IP:</span>
                <code className="px-2 py-1 bg-muted rounded font-mono">
                  {result.resolvedAddress}
                </code>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(result.resolvedAddress!)}
                  aria-label="Copy resolved IP"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {(result || liveOpenPorts.length > 0) && (
        <Suspense fallback={<Skeleton className="h-64 w-full" />}>
          <PortDistributionChart ports={result?.openPorts ?? liveOpenPorts} />
        </Suspense>
      )}

      {isScanning && liveOpenPorts.length === 0 && !result && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Scanning ports...</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 md:grid-cols-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-16" />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Open Ports Display */}
      {displayPorts.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-4">
              <CardTitle className="text-sm flex items-center gap-2">
                <Server className="h-4 w-4" />
                Open Ports ({displayPorts.length})
              </CardTitle>
              <div className="flex items-center gap-2">
                {/* Category Filter */}
                <Select
                  value={categoryFilter}
                  onValueChange={(value) =>
                    setCategoryFilter(value as ServiceCategory | "all")
                  }
                >
                  <SelectTrigger className="w-37.5">
                    <Filter className="h-4 w-4 mr-2" />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Categories</SelectItem>
                    <SelectItem value="web">Web</SelectItem>
                    <SelectItem value="database">Database</SelectItem>
                    <SelectItem value="remote">Remote Access</SelectItem>
                    <SelectItem value="mail">Mail</SelectItem>
                    <SelectItem value="file">File</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>

                {/* View Mode Toggle */}
                <div className="flex border rounded-md">
                  <Button
                    variant={viewMode === "grid" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("grid")}
                    className="rounded-r-none"
                    aria-label="Grid view"
                  >
                    <LayoutGrid className="h-4 w-4" />
                  </Button>
                  <Button
                    variant={viewMode === "list" ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => setViewMode("list")}
                    className="rounded-l-none"
                    aria-label="List view"
                  >
                    <List className="h-4 w-4" />
                  </Button>
                </div>

                {/* Export */}
                {result && (
                  <DropdownMenu>
                    <DropdownMenuTrigger>
                      <Button variant="outline" size="sm" aria-label="Export results">
                        <Download className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleExportCsv}>
                        Export as CSV
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={handleExportJson}>
                        Export as JSON
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}

                {/* Clear */}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button variant="outline" size="sm" onClick={handleClear} aria-label="Clear results">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear Results</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {viewMode === "grid" ? (
              <div className="grid gap-3 md:grid-cols-2">
                {displayPorts.map((port) => (
                  <PortCard
                    key={port.port}
                    port={port}
                    host={result?.host || host}
                  />
                ))}
              </div>
            ) : (
              <div className="space-y-2">
                {displayPorts.map((port) => (
                  <PortCard
                    key={port.port}
                    port={port}
                    host={result?.host || host}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grouped by Category View */}
      {displayPorts.length > 0 && categoryFilter === "all" && viewMode === "grid" && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {(Object.entries(portsByCategory) as [ServiceCategory, OpenPort[]][]).map(
            ([category, ports]) =>
              ports.length > 0 && (
                <Card key={category}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2 capitalize">
                      <CategoryIcon category={category} className="h-4 w-4" />
                      {category}
                      <Badge variant="secondary">{ports.length}</Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="flex flex-wrap gap-2">
                      {ports.map((port) => {
                        const info = getPortInfo(port);
                        return (
                          <Tooltip key={port.port}>
                            <TooltipTrigger>
                              <Badge
                                variant="outline"
                                className={getRiskColor(info.risk)}
                              >
                                {port.port} ({info.serviceName})
                              </Badge>
                            </TooltipTrigger>
                            <TooltipContent>
                              {info.serviceDescription || info.serviceName}
                            </TooltipContent>
                          </Tooltip>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )
          )}
        </div>
      )}

      {/* Empty State */}
      {!isScanning && !result && liveOpenPorts.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Server className="h-12 w-12 mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No scan results</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Enter a hostname or IP address above, select which ports to scan,
              and click "Scan Ports" to identify open services.
            </p>
          </CardContent>
        </Card>
      )}

      {/* No Open Ports Found */}
      {result && result.openPorts.length === 0 && (
        <Card className="border-green-500/50 bg-green-500/5">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <CheckCircle2 className="h-12 w-12 mb-4 text-green-500" />
            <h3 className="text-lg font-medium mb-2">No open ports found</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              {result.scannedPorts} ports were scanned on {result.host}, and no
              open ports were detected. The host may be behind a firewall or the
              services may not be running.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
