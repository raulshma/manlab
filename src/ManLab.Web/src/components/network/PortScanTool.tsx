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
  Clock,
  ShieldAlert,
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
  ShieldCheck,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { notify } from "@/lib/network-notify";
import {
  scanPorts as scanPortsApi,
  type PortScanResult,
  type OpenPort,
} from "@/api/networkApi";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { PortCard } from "@/components/network/PortCard";

import {
  getPortInfo,
  type RiskLevel,
  type ServiceCategory,
  ALL_COMMON_PORTS,
} from "@/components/network/port-constants";
import { announce, announceScanEvent } from "@/lib/accessibility";
import { useNetworkToolsOptional } from "@/hooks/useNetworkTools";
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
  // Network tools context for quick actions
  const networkTools = useNetworkToolsOptional();

  // Form state
  const [host, setHost] = useState(() => getStoredString(PORT_HOST_KEY, ""));
  const [portMode, setPortMode] = useState<PortMode>("common");
  const [customRangeStart, setCustomRangeStart] = useState("1");
  const [customRangeEnd, setCustomRangeEnd] = useState("1000");
  const [specificPorts, setSpecificPorts] = useState("");
  const [concurrency, setConcurrency] = useState(() => getStoredNumber(PORT_CONCURRENCY_KEY, 50));
  const [timeout, setTimeoutMs] = useState(() => getStoredNumber(PORT_TIMEOUT_KEY, 2000));
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

  // Handle pending action from context (e.g., quick port-scan from HostCard)
  useEffect(() => {
    if (
      networkTools?.pendingAction?.type === "port-scan" &&
      networkTools.pendingAction.target
    ) {
      const target = networkTools.pendingAction.target;
      const options = networkTools.pendingAction.options;
      setHost(target);
      setValidationError(null);
      
      // If specific ports were requested, set them
      if (options?.ports && options.ports.length > 0) {
        setPortMode("specific");
        setSpecificPorts(options.ports.join(", "));
      }
      
      networkTools.clearPendingAction();
      // Focus the input after setting the host
      globalThis.setTimeout(() => {
        inputRef.current?.focus();
        notify.info(`Ready to scan ports on ${target}`);
      }, 100);
    }
  }, [networkTools, networkTools?.pendingAction]);

  // Handle mode change
  const handleModeChange = (value: PortMode) => {
    setPortMode(value);
  };

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
    <div className="space-y-8 max-w-7xl mx-auto p-1">
      {/* Header Section */}
      <div className="flex flex-col md:flex-row gap-6 items-start md:items-center justify-between">
        <div>
           <h2 className="text-3xl font-bold tracking-tight bg-linear-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
             Port Scanner
           </h2>
           <p className="text-muted-foreground mt-1 text-lg">
             Identify open ports and running services on any target.
           </p>
        </div>
      </div>

      {/* Main Input Card */}
      <Card className="border-0 shadow-lg bg-card/60 backdrop-blur-xl ring-1 ring-border/50 overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-linear-to-r from-primary/50 via-primary to-primary/50 opacity-20" />
        <CardContent className="p-8 space-y-8">
           {/* Search Bar */}
           <div className="relative group">
              <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                <Globe className="h-5 w-5 text-muted-foreground group-focus-within:text-primary transition-colors" />
              </div>
              <Input
                id="port-scan-host"
                ref={inputRef}
                placeholder="Enter target hostname or IP (e.g., example.com, 192.168.1.1)"
                value={host}
                onChange={(e) => handleHostChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className={`pl-12 h-14 text-lg bg-background/50 border-input/50 focus:border-primary/50 focus:ring-primary/20 transition-all ${
                  validationError ? "border-destructive/50 focus:border-destructive" : ""
                }`}
                disabled={isLoading}
              />
              <div className="absolute inset-y-0 right-2 flex items-center">
                 <Button
                    onClick={handleScan}
                    disabled={isLoading || !host}
                    size="lg"
                    className="h-10 px-6 font-semibold shadow-sm transition-all hover:scale-[1.02]"
                 >
                    {isLoading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Scanning
                      </>
                    ) : (
                      <>
                        <Zap className="mr-2 h-4 w-4 fill-current" />
                         Scan Target
                      </>
                    )}
                 </Button>
              </div>
           </div>
           
           {validationError && (
             <motion.p
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-destructive font-medium flex items-center gap-2"
             >
                <AlertTriangle className="h-4 w-4" /> {validationError}
             </motion.p>
           )}

           {/* Scan Configuration */}
           <div className="grid lg:grid-cols-[1fr_300px] gap-8">
              {/* Left Column: Port Mode */}
              <div className="space-y-4">
                 <Label className="text-base font-semibold">Port Selection Mode</Label>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    {[
                      { value: "common", icon: Server, label: "Common Ports", sub: `${ALL_COMMON_PORTS.length} standard ports` },
                      { value: "custom", icon: LayoutGrid, label: "Custom Range", sub: "Define start & end" },
                      { value: "specific", icon: List, label: "Specific List", sub: "Individual ports" },
                    ].map((mode) => {
                      const Icon = mode.icon;
                      const isActive = portMode === mode.value;
                      return (
                        <button
                          key={mode.value}
                          type="button"
                          onClick={() => handleModeChange(mode.value as PortMode)}
                          className={`flex flex-col items-center justify-center text-center p-4 rounded-xl border transition-all cursor-pointer h-full hover:bg-accent/50 ${
                            isActive 
                              ? "border-primary/50 bg-primary/5 shadow-[0_0_0_1px_rgba(var(--primary),0.2)]" 
                              : "border-border/50 bg-card/50"
                          }`}
                        >
                           <Icon className={`h-6 w-6 mb-2 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                           <span className={`font-semibold ${isActive ? "text-foreground" : "text-muted-foreground"}`}>{mode.label}</span>
                           <span className="text-xs text-muted-foreground/70 mt-1">{mode.sub}</span>
                        </button>
                      )
                    })}
                  </div>

                  <div className="mt-2">
                    {portMode === "custom" && (
                         <div className="overflow-hidden pt-2">
                             <div className="flex items-end gap-3 p-4 rounded-xl bg-accent/20 border border-border/50">
                                <div className="space-y-1.5 flex-1">
                                  <Label htmlFor="range-start" className="text-xs">Start Port</Label>
                                  <Input 
                                    id="range-start" 
                                    type="number" 
                                    className="bg-background"
                                    value={customRangeStart}
                                    onChange={(e) => setCustomRangeStart(e.target.value)}
                                  />
                                </div>
                                <span className="pb-3 text-muted-foreground">-</span>
                                <div className="space-y-1.5 flex-1">
                                  <Label htmlFor="range-end" className="text-xs">End Port</Label>
                                  <Input 
                                    id="range-end" 
                                    type="number" 
                                    className="bg-background"
                                    value={customRangeEnd}
                                    onChange={(e) => setCustomRangeEnd(e.target.value)}
                                  />
                                </div>
                                <div className="pb-3 text-xs text-muted-foreground">
                                   {(parseInt(customRangeEnd) || 0) - (parseInt(customRangeStart) || 0) + 1} ports
                                </div>
                             </div>
                         </div>
                    )}
                    {portMode === "specific" && (
                        <div className="overflow-hidden pt-2">
                             <div className="space-y-2 p-4 rounded-xl bg-accent/20 border border-border/50">
                               <Label htmlFor="specific-ports" className="text-xs">Port List (comma separated)</Label>
                                <Input
                                    id="specific-ports"
                                    placeholder="80, 443, 8080, 3000-3005"
                                    className="bg-background"
                                    value={specificPorts}
                                    onChange={(e) => setSpecificPorts(e.target.value)}
                                  />
                                  <p className="text-xs text-muted-foreground">Range syntax (e.g. 1-100) is also supported.</p>
                             </div>
                        </div>
                    )}
                  </div>
              </div>

              {/* Right Column: Advanced */}
              <div className="space-y-6 bg-accent/10 p-5 rounded-xl border border-border/50">
                  <div className="space-y-3">
                     <div className="flex justify-between items-center">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Concurrency</Label>
                        <span className="text-xs font-mono bg-background px-2 py-0.5 rounded border">{concurrency}</span>
                     </div>
                    <Slider
                      value={[concurrency]}
                      onValueChange={(value) => {
                        const next = Array.isArray(value) ? value[0] : value;
                        setConcurrency(next);
                      }}
                        min={10} max={200} step={10}
                        className="**:[[role=slider]]:h-4 **:[[role=slider]]:w-4"
                      />
                  </div>

                  <div className="space-y-3">
                     <div className="flex justify-between items-center">
                        <Label className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Timeout</Label>
                        <span className="text-xs font-mono bg-background px-2 py-0.5 rounded border">{timeout}ms</span>
                     </div>
                    <Slider
                      value={[timeout]}
                      onValueChange={(value) => {
                        const next = Array.isArray(value) ? value[0] : value;
                        setTimeoutMs(next);
                      }}
                        min={500} max={10000} step={500} // Increased max timeout for flexibility
                        className="**:[[role=slider]]:h-4 **:[[role=slider]]:w-4"
                      />
                  </div>
              </div>
           </div>

            {/* Quick Presets */}
            <div className="space-y-2">
               <Label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Quick Presets</Label>
               <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
                  {QUICK_SCAN_PRESETS.map((preset) => {
                     const Icon = preset.icon;
                     return (
                       <Button
                         key={preset.name}
                         variant="outline"
                         size="sm"
                         onClick={() => handleQuickScan(preset)}
                         className="shrink-0 gap-2 h-9 border-dashed hover:border-solid hover:bg-accent/50 hover:text-primary transition-all"
                       >
                         <Icon className="h-3.5 w-3.5" />
                         {preset.name}
                       </Button>
                     )
                  })}
               </div>
            </div>
        </CardContent>
      </Card>


      {/* Notifications / Errors */}
      <AnimatePresence>
        {rateLimitMessage && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
             <Card className="border-orange-500/30 bg-orange-500/10 mb-6">
                <CardContent className="py-3 px-4 flex items-center gap-3">
                   <AlertTriangle className="h-5 w-5 text-orange-500" />
                   <span className="font-medium text-orange-700 dark:text-orange-300">{rateLimitMessage}</span>
                </CardContent>
             </Card>
          </motion.div>
        )}
      </AnimatePresence>

      
      {/* Search status & Progress */}
      <AnimatePresence>
        {isScanning && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
             <Card className="border-primary/20 bg-primary/5 overflow-hidden">
                <div className="absolute top-0 left-0 h-1 bg-primary/20 w-full">
                   <motion.div 
                     className="h-full bg-primary" 
                     initial={{ width: "0%" }}
                     animate={{ width: `${scanProgress}%` }}
                     transition={{ ease: "linear" }}
                   />
                </div>
                <CardContent className="p-6 flex flex-col md:flex-row items-center gap-6">
                   <div className="relative">
                      <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full animate-pulse" />
                      <Loader2 className="h-8 w-8 text-primary animate-spin relative z-10" />
                   </div>
                   <div className="flex-1 text-center md:text-left space-y-1">
                      <h3 className="font-semibold text-lg">Scanning Target...</h3>
                      <p className="text-muted-foreground">{host}</p>
                   </div>
                   <div className="flex gap-8 text-center">
                       <div>
                          <div className="text-2xl font-bold font-mono text-primary">{liveOpenPorts.length}</div>
                          <div className="text-xs text-muted-foreground uppercase tracking-wider">Found</div>
                       </div>
                       <div>
                          <div className="text-2xl font-bold font-mono text-muted-foreground">{scanProgress.toFixed(0)}%</div>
                           <div className="text-xs text-muted-foreground uppercase tracking-wider">Done</div>
                       </div>
                   </div>
                </CardContent>
             </Card>
          </motion.div>
        )}
      </AnimatePresence>


      {/* Main Results Section */}
      <AnimatePresence mode="wait">
        {(result || liveOpenPorts.length > 0) && (
          <motion.div 
            initial={{ opacity: 0 }} 
            animate={{ opacity: 1 }} 
            className="space-y-6"
          >
             {/* Metrics Row */}
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Status Card */}
                 <Card className={`overflow-hidden border-l-4 ${stats.hasHighRisk ? "border-l-orange-500" : "border-l-emerald-500"}`}>
                    <CardContent className="p-5 flex items-center justify-between">
                       <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Security Status</p>
                          <div className="font-bold text-lg">{stats.hasHighRisk ? "Action Required" : "System Secure"}</div>
                       </div>
                       <div className={`p-3 rounded-full ${stats.hasHighRisk ? "bg-orange-500/10 text-orange-500" : "bg-emerald-500/10 text-emerald-500"}`}>
                          {stats.hasHighRisk ? <ShieldAlert className="h-6 w-6" /> : <ShieldCheck className="h-6 w-6" />}
                       </div>
                    </CardContent>
                 </Card>

                 {/* Open Ports Count */}
                 <Card>
                    <CardContent className="p-5 flex items-center justify-between">
                       <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Open Ports</p>
                          <div className="font-bold text-2xl font-mono">{stats.total} <span className="text-sm font-sans font-normal text-muted-foreground">/ {result?.scannedPorts || liveOpenPorts.length}</span></div>
                       </div>
                       <div className="p-3 rounded-full bg-blue-500/10 text-blue-500">
                          <Server className="h-6 w-6" />
                       </div>
                    </CardContent>
                 </Card>

                 {/* Latency / Duration */}
                 <Card>
                    <CardContent className="p-5 flex items-center justify-between">
                       <div>
                          <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-1">Scan Duration</p>
                          <div className="font-bold text-lg font-mono">
                            {result ? `${(result.scanDurationMs / 1000).toFixed(2)}s` : isScanning ? "..." : "-"}
                          </div>
                       </div>
                       <div className="p-3 rounded-full bg-purple-500/10 text-purple-500">
                          <Clock className="h-6 w-6" />
                       </div>
                    </CardContent>
                 </Card>

                  {/* Risks */}
                 <Card>
                    <CardContent className="p-5">
                       <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold mb-2">Risk Breakdown</p>
                       <div className="flex gap-2">
                           {stats.byRisk.critical > 0 && <Badge variant="outline" className="bg-red-500/10 text-red-500 border-0">{stats.byRisk.critical} Crit</Badge>}
                           {stats.byRisk.high > 0 && <Badge variant="outline" className="bg-orange-500/10 text-orange-500 border-0">{stats.byRisk.high} High</Badge>}
                           {stats.byRisk.medium > 0 && <Badge variant="outline" className="bg-yellow-500/10 text-yellow-500 border-0">{stats.byRisk.medium} Med</Badge>}
                           {stats.byRisk.low > 0 && <Badge variant="outline" className="bg-emerald-500/10 text-emerald-500 border-0">{stats.byRisk.low} Low</Badge>}
                           {stats.total === 0 && <span className="text-sm text-muted-foreground">No risks detected</span>}
                       </div>
                    </CardContent>
                 </Card>
             </div>

            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-6">
                {/* Left Column: Ports List */}
                <div className="space-y-4">
                   <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                      <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as "grid" | "list")} className="w-auto">
                        <TabsList className="h-9 mb-0 bg-muted/50 p-1">
                            <TabsTrigger value="grid" className="px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
                               <LayoutGrid className="mr-2 h-3.5 w-3.5" /> Grid
                            </TabsTrigger>
                            <TabsTrigger value="list" className="px-3 text-xs data-[state=active]:bg-background data-[state=active]:shadow-sm">
                               <List className="mr-2 h-3.5 w-3.5" /> List
                            </TabsTrigger>
                        </TabsList>
                      </Tabs>
                      
                       <div className="flex items-center gap-2">
                          <Select value={categoryFilter} onValueChange={(v) => setCategoryFilter(v as ServiceCategory | "all")}>
                             <SelectTrigger className="h-9 w-45 text-xs">
                                <Filter className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                                <SelectValue />
                             </SelectTrigger>
                             <SelectContent>
                                <SelectItem value="all">All Categories</SelectItem>
                                <SelectItem value="web">Web Services</SelectItem>
                                <SelectItem value="database">Databases</SelectItem>
                                <SelectItem value="remote">Remote Access</SelectItem>
                                <SelectItem value="mail">Mail</SelectItem>
                                <SelectItem value="file">File Transfer</SelectItem>
                             </SelectContent>
                          </Select>
                          
                          {result && (
                            <DropdownMenu>
                              <DropdownMenuTrigger className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 w-9 p-0")}>
                                <Download className="h-4 w-4" />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={handleExportCsv}>Export CSV</DropdownMenuItem>
                                <DropdownMenuItem onClick={handleExportJson}>Export JSON</DropdownMenuItem>
                                <DropdownMenuItem onClick={handleClear} className="text-destructive focus:text-destructive">Clear Results</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                       </div>
                   </div>

                   {displayPorts.length === 0 ? (
                      <Card className="border-dashed bg-muted/30">
                        <CardContent className="py-12 flex flex-col items-center text-center text-muted-foreground">
                           <Server className="h-10 w-10 mb-3 opacity-20" />
                           <p>No ports found matching your filters.</p>
                        </CardContent>
                      </Card>
                   ) : (
                     <div className={viewMode === "grid" ? "grid grid-cols-1 md:grid-cols-2 gap-4" : "space-y-2"}>
                        <AnimatePresence mode="popLayout">
                          {displayPorts.map((port, idx) => (
                              <PortCard 
                                key={port.port} 
                                port={port} 
                                host={result?.host || host} 
                                index={idx}
                              />
                          ))}
                        </AnimatePresence>
                     </div>
                   )}
                </div>

                {/* Right Column: Chart & Summary */}
                <div className="space-y-6">
                   <Card>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">Service Distribution</CardTitle>
                      </CardHeader>
                      <CardContent>
                          <Suspense fallback={<Skeleton className="h-50 w-full" />}>
                            <PortDistributionChart ports={result?.openPorts ?? liveOpenPorts} />
                          </Suspense>
                      </CardContent>
                   </Card>
                   
                   {result?.resolvedAddress && result.resolvedAddress !== result.host && (
                      <Card>
                         <CardContent className="p-4 flex items-center justify-between">
                            <div className="space-y-1">
                               <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Resolved IP</p>
                               <p className="font-mono text-sm">{result.resolvedAddress}</p>
                            </div>
                            <Button variant="ghost" size="icon" onClick={() => copyToClipboard(result.resolvedAddress!)}>
                               <Copy className="h-4 w-4" />
                            </Button>
                         </CardContent>
                      </Card>
                   )}
                </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      
      {/* Empty Initial State */}
      {!isScanning && !result && liveOpenPorts.length === 0 && (
         <div className="min-h-75 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed rounded-xl border-muted/50 bg-muted/5">
            <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center mb-4">
               <Server className="h-8 w-8 text-muted-foreground/50" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Ready to Scan</h3>
            <p className="text-muted-foreground max-w-md">
               Enter a target above to begin discovering open ports and services.
               Select a quick preset or define a custom range for specific targeting.
            </p>
         </div>
      )}
    </div>
  );
}
