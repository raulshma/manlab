/**
 * TracerouteTool Component
 * Network traceroute utility for tracing the path to a remote host.
 * Features:
 * - Input field for target host with validation
 * - Max hops configuration slider (1-64)
 * - Timeout configuration slider
 * - Visual hop-by-hop display with progress
 * - Show hop number, IP, hostname, RTT
 * - Highlight destination hop
 * - Export path to text/CSV
 * - Real-time hop updates via SignalR
 */

import { useState, useCallback, useRef, useEffect } from "react";
import {
  Route,
  Loader2,
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  MapPin,
  Timer,
  AlertCircle,
  Copy,
  Target,
  AlertTriangle,
  Share2,
  Activity,
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
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
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { notify } from "@/lib/network-notify";
import {
  traceroute as tracerouteApi,
  type TracerouteResult,
  type TracerouteHop,
} from "@/api/networkApi";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import { useNetworkToolsOptional } from "@/hooks/useNetworkTools";
import { announce, announceScanEvent } from "@/lib/accessibility";

// ============================================================================
// Types
// ============================================================================

interface TracerouteHistoryEntry {
  id: string;
  timestamp: Date;
  result: TracerouteResult;
}

const TRACE_HOST_KEY = "manlab:network:traceroute-host";
const TRACE_MAXHOPS_KEY = "manlab:network:traceroute-max-hops";
const TRACE_TIMEOUT_KEY = "manlab:network:traceroute-timeout";

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
 * Format timestamp for display
 */
function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

/**
 * Get RTT color based on latency value
 */
function getRttColor(rtt: number): string {
  if (rtt < 20) return "text-green-500";
  if (rtt < 50) return "text-emerald-500";
  if (rtt < 100) return "text-yellow-500";
  if (rtt < 200) return "text-orange-500";
  return "text-red-500";
}

/**
 * Get RTT background color for progress bar
 */
function getRttBgColor(rtt: number): string {
  if (rtt < 20) return "bg-green-500";
  if (rtt < 50) return "bg-emerald-500";
  if (rtt < 100) return "bg-yellow-500";
  if (rtt < 200) return "bg-orange-500";
  return "bg-red-500";
}

/**
 * Calculate max RTT from hops for normalization
 */
function getMaxRtt(hops: TracerouteHop[]): number {
  const successfulHops = hops.filter(
    (h) => h.status === "Success" || h.status === "TtlExpired"
  );
  if (successfulHops.length === 0) return 100;
  return Math.max(...successfulHops.map((h) => h.roundtripTime), 1);
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
 * Export traceroute results to text
 */
function exportToText(result: TracerouteResult): void {
  const lines = [
    `Traceroute to ${result.hostname}${result.resolvedAddress ? ` (${result.resolvedAddress})` : ""}`,
    `Destination Reached: ${result.reachedDestination ? "Yes" : "No"}`,
    `Total Hops: ${result.hops.length}`,
    "",
    "Hop | IP Address | Hostname | RTT (ms) | Status",
    "-".repeat(70),
  ];

  result.hops.forEach((hop) => {
    const ip = hop.address || "*";
    const hostname = hop.hostname || "-";
    const rtt =
      hop.status === "Success" || hop.status === "TtlExpired"
        ? (hop.roundtripTime === 0 ? "<1" : `${hop.roundtripTime}`)
        : "*";
    lines.push(
      `${hop.hopNumber.toString().padStart(3)} | ${ip.padEnd(15)} | ${hostname.padEnd(30)} | ${rtt.padStart(6)} | ${hop.status}`
    );
  });

  const text = lines.join("\n");
  const blob = new Blob([text], { type: "text/plain;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `traceroute-${result.hostname}-${new Date().toISOString().slice(0, 10)}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
}

/**
 * Export traceroute results to CSV
 */
function exportToCSV(result: TracerouteResult): void {
  const headers = ["Hop", "IP Address", "Hostname", "RTT (ms)", "Status"];
  const rows = result.hops.map((hop) => [
    hop.hopNumber.toString(),
    hop.address || "*",
    hop.hostname || "",
    hop.status === "Success" || hop.status === "TtlExpired"
      ? (hop.roundtripTime === 0 ? "<1" : hop.roundtripTime.toString())
      : "",
    hop.status,
  ]);

  const csvContent = [
    `# Traceroute to ${result.hostname}${result.resolvedAddress ? ` (${result.resolvedAddress})` : ""}`,
    `# Destination Reached: ${result.reachedDestination ? "Yes" : "No"}`,
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `traceroute-${result.hostname}-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
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

// ============================================================================
// Sub-Components
// ============================================================================



interface LatencyChartProps {
  hops: TracerouteHop[];
}

function LatencyChart({ hops }: LatencyChartProps) {
  const data = hops.map((h) => ({
    hop: h.hopNumber,
    rtt: h.status === "Success" || h.status === "TtlExpired" ? h.roundtripTime : 0,
    isTimeout: h.status === "TimedOut",
  }));

  if (data.length < 2) return null;

  return (
    <div className="h-[200px] w-full mt-6 mb-8">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-medium">Latency Timeline</h3>
      </div>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="colorRtt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" opacity={0.5} />
          <XAxis 
            dataKey="hop" 
            stroke="hsl(var(--muted-foreground))" 
            fontSize={12} 
            tickLine={false}
            axisLine={false}
          />
          <YAxis 
            stroke="hsl(var(--muted-foreground))" 
            fontSize={12} 
            tickLine={false}
            axisLine={false}
            unit="ms"
          />
          <RechartsTooltip
            contentStyle={{
              backgroundColor: "hsl(var(--card))",
              borderColor: "hsl(var(--border))",
              borderRadius: "0.5rem",
              fontSize: "12px",
            }}
            itemStyle={{ color: "hsl(var(--foreground))" }}
            formatter={(value: number) => [`${value === 0 ? "<1" : value}ms`, "Latency"]}
            labelFormatter={(label) => `Hop ${label}`}
          />
          <Area
            type="monotone"
            dataKey="rtt"
            stroke="#10b981"
            strokeWidth={2}
            fillOpacity={1}
            fill="url(#colorRtt)"
            animationDuration={1000}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

interface HopTimelineItemProps {
  hop: TracerouteHop;
  isDestination: boolean;
  isFirst: boolean;
  isLast: boolean;
  maxRtt: number;
}

function HopTimelineItem({
  hop,
  isDestination,
  isFirst,
  isLast,
  maxRtt,
}: HopTimelineItemProps) {
  const isTimeout = hop.status === "TimedOut";
  const isSuccess = hop.status === "Success" || hop.status === "TtlExpired";
  const rttPercentage = isSuccess ? (hop.roundtripTime / maxRtt) * 100 : 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="relative pl-8 pb-0"
    >
      {/* Connector Line */}
      {!isLast && (
        <div 
          className="absolute left-[11px] top-8 bottom-[-16px] w-[2px] bg-border" 
          aria-hidden="true"
        />
      )}

      {/* Node Dot */}
      <div
        className={`absolute left-0 top-1 h-6 w-6 rounded-full border-2 flex items-center justify-center z-10 bg-background transition-colors ${
          isDestination
            ? "border-green-500 text-green-500"
            : isFirst
            ? "border-primary text-primary"
            : isTimeout
            ? "border-muted-foreground/30 text-muted-foreground/50"
            : "border-primary/40 text-primary/70"
        }`}
      >
        <span className="text-[10px] font-bold font-mono">{hop.hopNumber}</span>
      </div>

      {/* Card Content */}
      <div 
        className={`group relative flex flex-col sm:flex-row sm:items-center gap-3 p-3 rounded-lg border transition-all duration-200 mb-4 ${
          isDestination
            ? "bg-green-500/5 border-green-500/20 hover:border-green-500/40"
            : isTimeout
            ? "bg-muted/10 border-border hover:bg-muted/20"
            : "bg-card border-border hover:border-primary/20 hover:shadow-sm"
        }`}
      >
        {/* Main Info */}
        <div className="flex-1 min-w-0 grid gap-1">
          <div className="flex items-center gap-2">
            <span className={`font-mono text-sm ${isTimeout ? "text-muted-foreground italic" : "font-medium"}`}>
               {isTimeout ? "Request timed out" : hop.address}
            </span>
            {hop.hostname && hop.hostname !== hop.address && (
              <span className="text-xs text-muted-foreground truncate hidden sm:inline-block max-w-[200px]">
                {hop.hostname}
              </span>
            )}
            {isDestination && (
              <Badge variant="outline" className="ml-auto sm:ml-2 h-5 text-[10px] bg-green-500/10 text-green-600 border-green-500/20">
                Destination
              </Badge>
            )}
          </div>
          
          {/* Mobile Hostname */}
          {hop.hostname && hop.hostname !== hop.address && (
             <span className="text-xs text-muted-foreground truncate sm:hidden">
                {hop.hostname}
             </span>
          )}
        </div>

        {/* RTT Stats */}
        {!isTimeout && (
          <div className="flex items-center gap-4 shrink-0 mt-2 sm:mt-0">
            {/* Visual RTT Bar */}
            <div className="hidden sm:block w-24 h-1.5 bg-secondary rounded-full overflow-hidden">
               <motion.div 
                 initial={{ width: 0 }}
                 animate={{ width: `${Math.max(rttPercentage, 5)}%` }}
                 className={`h-full rounded-full ${getRttBgColor(hop.roundtripTime)}`}
               />
            </div>
            
            <div className={`flex items-center gap-1.5 text-sm font-mono w-16 justify-end ${getRttColor(hop.roundtripTime)}`}>
              <Activity className="h-3 w-3 opacity-70" />
              <span>{hop.roundtripTime === 0 ? "<1ms" : `${hop.roundtripTime}ms`}</span>
            </div>
          </div>
        )}
        
        {/* Copy Action */}
        {!isTimeout && hop.address && (
           <Button
             variant="ghost"
             size="icon"
             className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity absolute right-2 top-2 sm:static sm:opacity-0 sm:group-hover:opacity-100"
             onClick={() => copyToClipboard(hop.address!)}
           >
             <Copy className="h-3.5 w-3.5 text-muted-foreground" />
             <span className="sr-only">Copy IP</span>
           </Button>
        )}
      </div>
    </motion.div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function TracerouteTool() {
  // Network tools context for quick actions
  const networkTools = useNetworkToolsOptional();

  // Form state
  const [host, setHost] = useState(() => getStoredString(TRACE_HOST_KEY, ""));
  const [maxHops, setMaxHops] = useState(() => getStoredNumber(TRACE_MAXHOPS_KEY, 30));
  const [timeout, setTimeoutMs] = useState(() => getStoredNumber(TRACE_TIMEOUT_KEY, 1000));
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);

  // Result state
  const [result, setResult] = useState<TracerouteResult | null>(null);
  const [liveHops, setLiveHops] = useState<TracerouteHop[]>([]);
  const [isTracing, setIsTracing] = useState(false);
  const [history, setHistory] = useState<TracerouteHistoryEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  // Input ref for focus
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle pending action from context (e.g., quick traceroute from HostCard)
  useEffect(() => {
    if (
      networkTools?.pendingAction?.type === "traceroute" &&
      networkTools.pendingAction.target
    ) {
      const target = networkTools.pendingAction.target;
      setHost(target);
      setValidationError(null);
      networkTools.clearPendingAction();
      // Focus the input after setting the host
      globalThis.setTimeout(() => {
        inputRef.current?.focus();
        notify.info(`Ready to trace route to ${target}`);
      }, 100);
    }
  }, [networkTools, networkTools?.pendingAction]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(TRACE_HOST_KEY, host);
    localStorage.setItem(TRACE_MAXHOPS_KEY, String(maxHops));
    localStorage.setItem(TRACE_TIMEOUT_KEY, String(timeout));
  }, [host, maxHops, timeout]);

  useEffect(() => {
    return () => {
      abortRef.current?.abort();
    };
  }, []);

  // SignalR
  const { isConnected, subscribeToTraceroute, traceroute: hubTraceroute } =
    useNetworkHub();

  // Subscribe to traceroute events
  useEffect(() => {
    if (!isConnected) return;

    const unsubscribe = subscribeToTraceroute({
      onTracerouteStarted: (event) => {
        console.log("Traceroute started:", event);
        setLiveHops([]);
        setIsTracing(true);
      },
      onTracerouteHop: (event) => {
        console.log("Traceroute hop:", event);
        setLiveHops((prev) => [...prev, event.hop]);
      },
      onTracerouteCompleted: (event) => {
        console.log("Traceroute completed:", event);
        setResult(event.result);
        setLiveHops([]);
        setIsTracing(false);

        // Add to history
        const newEntry: TracerouteHistoryEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          result: event.result,
        };
        setHistory((prev) => [newEntry, ...prev].slice(0, 5));
      },
    });

    return unsubscribe;
  }, [isConnected, subscribeToTraceroute]);

  // Handle input change with validation
  const handleHostChange = useCallback((value: string) => {
    setHost(value);
    if (value && !isValidHost(value)) {
      setValidationError("Please enter a valid hostname or IP address");
    } else {
      setValidationError(null);
    }
  }, []);

  // Handle traceroute submission
  const handleTraceroute = useCallback(async () => {
    if (!host || !isValidHost(host)) {
      setValidationError("Please enter a valid hostname or IP address");
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setValidationError(null);
    setRateLimitMessage(null);
    setResult(null);
    setLiveHops([]);

    try {
      // Try SignalR first for real-time updates
      if (isConnected) {
        setIsTracing(true);
        const traceResult = await hubTraceroute(host, maxHops, timeout);
        setResult(traceResult);
        setIsTracing(false);

        // Add to history
        const newEntry: TracerouteHistoryEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          result: traceResult,
        };
        setHistory((prev) => [newEntry, ...prev].slice(0, 5));

        if (traceResult.reachedDestination) {
          notify.success(
            `Traceroute complete: ${traceResult.hops.length} hops to destination`
          );
          announceScanEvent(
            "completed",
            "Traceroute",
            `Reached destination in ${traceResult.hops.length} hops`
          );
        } else {
          notify.warning(
            `Traceroute incomplete: Destination not reached after ${traceResult.hops.length} hops`
          );
          announce(
            `Traceroute incomplete. Destination not reached after ${traceResult.hops.length} hops`,
            "polite"
          );
        }
      } else {
        // Fallback to REST API
        abortRef.current?.abort();
        const controller = new AbortController();
        abortRef.current = controller;

        const traceResult = await tracerouteApi(
          {
            host,
            maxHops,
            timeout,
          },
          { signal: controller.signal }
        );
        setResult(traceResult);

        // Add to history
        const newEntry: TracerouteHistoryEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          result: traceResult,
        };
        setHistory((prev) => [newEntry, ...prev].slice(0, 5));

        if (traceResult.reachedDestination) {
          notify.success(
            `Traceroute complete: ${traceResult.hops.length} hops to destination`
          );
        } else {
          notify.warning(
            `Traceroute incomplete: Destination not reached after ${traceResult.hops.length} hops`
          );
        }
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Traceroute request failed";
      if (errorMessage.toLowerCase().includes("rate") || errorMessage.includes("429")) {
        setRateLimitMessage("Rate limit reached. Please wait before retrying.");
      }
      notify.error(errorMessage);
      setResult(null);
      setIsTracing(false);
    } finally {
      setIsLoading(false);
    }
  }, [host, maxHops, timeout, isConnected, hubTraceroute]);

  // Handle Enter key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isLoading) {
        handleTraceroute();
      }
    },
    [handleTraceroute, isLoading]
  );

  // Clear results
  const handleClear = useCallback(() => {
    setResult(null);
    setLiveHops([]);
    setHistory([]);
    notify.info("Results cleared");
    announce("Traceroute results cleared", "polite");
  }, []);

  // Export functions
  const handleExportText = useCallback(() => {
    if (!result) {
      notify.error("No data to export");
      return;
    }
    exportToText(result);
    notify.success("Exported to text file");
  }, [result]);

  const handleExportCSV = useCallback(() => {
    if (!result) {
      notify.error("No data to export");
      return;
    }
    exportToCSV(result);
    notify.success("Exported to CSV");
  }, [result]);

  // Determine which hops to display
  const displayHops = isTracing && liveHops.length > 0 ? liveHops : result?.hops || [];
  const maxRtt = getMaxRtt(displayHops);

  // Calculate statistics
  const successfulHops = displayHops.filter(
    (h) => h.status === "Success" || h.status === "TtlExpired"
  );
  const avgRtt =
    successfulHops.length > 0
      ? Math.round(
          successfulHops.reduce((sum, h) => sum + h.roundtripTime, 0) /
            successfulHops.length
        )
      : 0;

  const timeoutCount = displayHops.filter((h) => h.status === "TimedOut").length;

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header & Input Section */}
      <div className="grid gap-6">
        <div className="flex items-center justify-between">
            <h2 className="text-2xl font-light tracking-tight flex items-center gap-2">
              <Route className="h-6 w-6 text-primary" />
              Traceroute
            </h2>
            <div className="flex gap-2">
              {(result || displayHops.length > 0) && (
                <motion.div 
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="flex gap-2"
                >
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" onClick={handleExportText} className="rounded-full">
                        <Download className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export TXT</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" onClick={handleExportCSV} className="rounded-full">
                        <Share2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export CSV</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="icon" onClick={handleClear} className="rounded-full hover:bg-destructive/10 hover:text-destructive">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Clear</TooltipContent>
                  </Tooltip>
                </motion.div>
              )}
            </div>
        </div>

        <Card className="border-none shadow-lg bg-card/50 backdrop-blur-sm">
          <CardContent className="pt-6">
            <div className="flex flex-col md:flex-row gap-4 items-end">
              <div className="flex-1 space-y-2 w-full">
                <Label htmlFor="traceroute-host">Target Host or IP</Label>
                <div className="relative">
                   <Target className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                   <Input
                    id="traceroute-host"
                    ref={inputRef}
                    placeholder="google.com"
                    value={host}
                    onChange={(e) => handleHostChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    className={`pl-9 h-11 transition-all ${validationError ? "border-destructive focus-visible:ring-destructive" : "focus-visible:ring-primary"}`}
                    disabled={isLoading}
                  />
                </div>
              </div>
              
              <div className="flex gap-4 w-full md:w-auto">
                 <div className="space-y-2 flex-1 md:flex-none md:w-32">
                    <div className="flex justify-between">
                       <Label className="text-xs">Max Hops</Label>
                       <span className="text-xs text-muted-foreground">{maxHops}</span>
                    </div>
                    <Slider
                      value={[maxHops]}
                      onValueChange={(val: number[]) => setMaxHops(val[0])}
                      min={1}
                      max={64}
                      step={1}
                      disabled={isLoading}
                    />
                 </div>
                 <div className="space-y-2 flex-1 md:flex-none md:w-32">
                    <div className="flex justify-between">
                       <Label className="text-xs">Timeout</Label>
                       <span className="text-xs text-muted-foreground">{(timeout/1000).toFixed(1)}s</span>
                    </div>
                    <Slider
                      value={[timeout]}
                      onValueChange={(val: number[]) => setTimeoutMs(val[0])}
                      min={100}
                      max={5000}
                      step={100}
                      disabled={isLoading}
                    />
                 </div>
              </div>

              <Button
                onClick={handleTraceroute}
                disabled={isLoading || !host}
                className="h-11 min-w-[120px] shadow-md transition-all hover:scale-105 active:scale-95"
                size="lg"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Tracing
                  </>
                ) : (
                  <>
                    <Route className="mr-2 h-4 w-4" />
                    Trace
                  </>
                )}
              </Button>
            </div>
            {validationError && (
              <p className="text-sm text-destructive mt-2 animate-in slide-in-from-top-1 opacity-0 fade-in-0 fill-mode-forwards duration-300">
                {validationError}
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Rate Limit Alert */}
      {rateLimitMessage && (
        <motion.div 
           initial={{ opacity: 0, y: -10 }} 
           animate={{ opacity: 1, y: 0 }}
           className="rounded-md bg-orange-500/10 p-4 border border-orange-500/20 flex items-center gap-3 text-orange-600 dark:text-orange-400"
        >
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <p className="text-sm font-medium">{rateLimitMessage}</p>
        </motion.div>
      )}

      {/* Results Section */}
      <AnimatePresence mode="wait">
         {displayHops.length > 0 && (
           <motion.div
             initial={{ opacity: 0 }}
             animate={{ opacity: 1 }}
             exit={{ opacity: 0 }}
             className="space-y-6"
           >
             {/* Stats Grid */}
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <Card className="bg-card/50 backdrop-blur-sm">
                   <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                         <MapPin className="h-4 w-4" />
                         <span className="text-xs font-medium uppercase tracking-wider">Hops</span>
                      </div>
                      <div className="text-2xl font-bold font-mono">
                         {displayHops.length}
                         <span className="text-sm font-normal text-muted-foreground ml-1">/ {maxHops}</span>
                      </div>
                   </CardContent>
                </Card>
                <Card className="bg-card/50 backdrop-blur-sm">
                   <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                         <Timer className="h-4 w-4" />
                         <span className="text-xs font-medium uppercase tracking-wider">Avg Latency</span>
                      </div>
                      <div className={`text-2xl font-bold font-mono ${getRttColor(avgRtt)}`}>
                         {avgRtt === 0 && successfulHops.length > 0 ? "<1" : avgRtt}
                         <span className="text-sm text-muted-foreground ml-1">ms</span>
                      </div>
                   </CardContent>
                </Card>
                <Card className="bg-card/50 backdrop-blur-sm">
                   <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                         <AlertCircle className="h-4 w-4" />
                         <span className="text-xs font-medium uppercase tracking-wider">Packet Loss</span>
                      </div>
                      <div className="text-2xl font-bold font-mono">
                         {displayHops.length > 0 ? ((timeoutCount / displayHops.length) * 100).toFixed(0) : 0}
                         <span className="text-sm text-muted-foreground ml-1">%</span>
                      </div>
                   </CardContent>
                </Card>
                <Card className={`bg-card/50 backdrop-blur-sm border-l-4 ${result?.reachedDestination ? "border-l-green-500" : isTracing ? "border-l-blue-500" : "border-l-yellow-500"}`}>
                   <CardContent className="pt-6">
                      <div className="flex items-center gap-2 text-muted-foreground mb-2">
                         <Activity className="h-4 w-4" />
                         <span className="text-xs font-medium uppercase tracking-wider">Status</span>
                      </div>
                      <div className="font-bold flex items-center gap-2">
                         {result?.reachedDestination ? (
                           <>
                             <CheckCircle2 className="h-5 w-5 text-green-500" />
                             <span>Success</span>
                           </>
                         ) : isTracing ? (
                           <>
                             <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
                             <span>Tracing...</span>
                           </>
                         ) : (
                           <>
                             <XCircle className="h-5 w-5 text-yellow-500" />
                             <span>Incomplete</span>
                           </>
                         )}
                      </div>
                   </CardContent>
                </Card>
             </div>

             {/* Chart & Timeline Layout */}
             <div className="grid lg:grid-cols-[1fr_300px] gap-8">
                {/* Main Timeline Column */}
                <div className="space-y-6">
                   <LatencyChart hops={displayHops} />

                   <Card className="border-none shadow-none bg-transparent">
                      <CardContent className="p-0">
                         {displayHops.map((hop, index) => (
                            <HopTimelineItem
                              key={`${hop.hopNumber}-${index}`}
                              hop={hop}
                              isDestination={hop.status === "Success" && index === displayHops.length - 1}
                              isFirst={index === 0}
                              isLast={index === displayHops.length - 1}
                              maxRtt={maxRtt}
                            />
                         ))}
                         
                         {isTracing && (
                           <div className="pl-8 pt-4 pb-8 flex items-center gap-3 animate-pulse">
                              <div className="h-2 w-2 rounded-full bg-primary" />
                              <span className="text-sm text-muted-foreground">Probing hop {displayHops.length + 1}...</span>
                           </div>
                         )}
                      </CardContent>
                   </Card>
                </div>

                {/* Sidebar Info (History) */}
                <div className="space-y-6">
                   {/* Current Details */}
                   {result?.resolvedAddress && (
                     <Card>
                       <CardHeader className="pb-3">
                         <CardTitle className="text-sm font-medium">Target Details</CardTitle>
                       </CardHeader>
                       <CardContent className="text-sm space-y-3">
                          <div className="flex justify-between border-b pb-2">
                            <span className="text-muted-foreground">Hostname</span>
                            <span className="font-mono text-right truncate max-w-[150px]">{result.hostname}</span>
                          </div>
                          <div className="flex justify-between items-center border-b pb-2">
                            <span className="text-muted-foreground">IP Address</span>
                            <div className="flex items-center gap-2">
                              <code className="bg-muted px-1.5 py-0.5 rounded font-mono text-xs">{result.resolvedAddress}</code>
                              <Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => copyToClipboard(result.resolvedAddress!)}>
                                <Copy className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <div className="flex justify-between">
                             <span className="text-muted-foreground">Time</span>
                             <span>{new Date().toLocaleTimeString()}</span>
                          </div>
                       </CardContent>
                     </Card>
                   )}

                   {/* History List */}
                   {history.length > 0 && (
                     <Card className="max-h-[500px] overflow-hidden flex flex-col">
                       <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium flex items-center gap-2">
                             <Clock className="h-4 w-4" />
                             Recent Traces
                          </CardTitle>
                       </CardHeader>
                       <CardContent className="overflow-y-auto flex-1 p-0">
                          {history.map((entry) => (
                             <div 
                               key={entry.id}
                               onClick={() => {
                                 setResult(entry.result);
                                 setLiveHops([]); // Stop showing live
                               }}
                               className="p-3 border-b last:border-0 hover:bg-muted/50 cursor-pointer transition-colors"
                             >
                                <div className="flex justify-between items-start mb-1">
                                   <span className="font-medium text-sm truncate max-w-[120px]">{entry.result.hostname}</span>
                                   <span className="text-[10px] text-muted-foreground">{formatTime(entry.timestamp)}</span>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                   <Badge variant={entry.result.reachedDestination ? "default" : "secondary"} className={`text-[10px] h-4 ${entry.result.reachedDestination ? "bg-green-500/10 text-green-600 hover:bg-green-500/20" : ""}`}>
                                      {entry.result.reachedDestination ? "Success" : "Failed"}
                                   </Badge>
                                   <span className="text-[10px] text-muted-foreground">{entry.result.hops.length} Hops</span>
                                </div>
                             </div>
                          ))}
                       </CardContent>
                     </Card>
                   )}
                </div>
             </div>
           </motion.div>
         )}
      </AnimatePresence>

      {/* Empty State */}
      {!isTracing && displayHops.length === 0 && (
        <motion.div 
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-center py-20 opacity-50"
        >
           <Route className="h-16 w-16 mx-auto mb-4 text-muted-foreground/30" />
           <h3 className="text-lg font-medium text-muted-foreground">Ready to trace</h3>
           <p className="text-sm text-muted-foreground/70 max-w-sm mx-auto mt-2">
             Enter a target host or IP address to visualize the network path.
           </p>
        </motion.div>
      )}
    </div>
  );
}
