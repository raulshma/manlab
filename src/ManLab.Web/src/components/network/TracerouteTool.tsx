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
  ArrowRight,
  Copy,
  Target,
  CircleDot,
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
import { toast } from "sonner";
import {
  traceroute as tracerouteApi,
  type TracerouteResult,
  type TracerouteHop,
} from "@/api/networkApi";
import { useNetworkHub } from "@/hooks/useNetworkHub";

// ============================================================================
// Types
// ============================================================================

interface TracerouteHistoryEntry {
  id: string;
  timestamp: Date;
  result: TracerouteResult;
}

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
    toast.success("Copied to clipboard");
  } catch {
    toast.error("Failed to copy to clipboard");
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
        ? `${hop.roundtripTime}`
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
      ? hop.roundtripTime.toString()
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

// ============================================================================
// Sub-Components
// ============================================================================

interface HopCardProps {
  hop: TracerouteHop;
  isDestination: boolean;
  isFirst: boolean;
  maxRtt: number;
}

function HopCard({ hop, isDestination, isFirst, maxRtt }: HopCardProps) {
  const isTimeout = hop.status === "TimedOut";
  const isSuccess = hop.status === "Success" || hop.status === "TtlExpired";
  const rttPercentage = isSuccess ? (hop.roundtripTime / maxRtt) * 100 : 0;

  return (
    <div
      className={`relative flex items-start gap-4 p-4 rounded-lg border transition-all ${
        isDestination
          ? "border-green-500/50 bg-green-500/5"
          : isTimeout
            ? "border-muted bg-muted/20"
            : "border-border hover:border-primary/30"
      }`}
    >
      {/* Hop Number Badge */}
      <div
        className={`shrink-0 flex items-center justify-center w-10 h-10 rounded-full font-bold text-sm ${
          isDestination
            ? "bg-green-500 text-white"
            : isFirst
              ? "bg-primary text-primary-foreground"
              : isTimeout
                ? "bg-muted text-muted-foreground"
                : "bg-secondary text-secondary-foreground"
        }`}
      >
        {hop.hopNumber}
      </div>

      {/* Hop Details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {isDestination ? (
            <Target className="h-4 w-4 text-green-500" />
          ) : isFirst ? (
            <CircleDot className="h-4 w-4 text-primary" />
          ) : isTimeout ? (
            <AlertCircle className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
          )}
          {isTimeout ? (
            <span className="font-medium text-muted-foreground">
              Request timed out
            </span>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              {hop.address && (
                <Tooltip>
                  <TooltipTrigger>
                    <button
                      onClick={() => copyToClipboard(hop.address!)}
                      className="font-mono text-sm hover:text-primary transition-colors"
                    >
                      {hop.address}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Click to copy</TooltipContent>
                </Tooltip>
              )}
              {hop.hostname && hop.hostname !== hop.address && (
                <span className="text-sm text-muted-foreground truncate max-w-[200px]">
                  ({hop.hostname})
                </span>
              )}
            </div>
          )}
        </div>

        {/* RTT Progress Bar */}
        {isSuccess && (
          <div className="mt-2">
            <div className="flex items-center gap-2 mb-1">
              <Timer className="h-3 w-3 text-muted-foreground" />
              <span
                className={`text-sm font-medium ${getRttColor(hop.roundtripTime)}`}
              >
                {hop.roundtripTime}ms
              </span>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full ${getRttBgColor(hop.roundtripTime)} transition-all duration-300`}
                style={{ width: `${Math.max(rttPercentage, 5)}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Status Badge */}
      <Badge
        variant={isDestination ? "default" : isTimeout ? "outline" : "secondary"}
        className={isDestination ? "bg-green-500" : ""}
      >
        {isDestination ? "Destination" : isTimeout ? "Timeout" : "OK"}
      </Badge>
    </div>
  );
}

// ============================================================================
// Main Component
// ============================================================================

export function TracerouteTool() {
  // Form state
  const [host, setHost] = useState("");
  const [maxHops, setMaxHops] = useState(30);
  const [timeout, setTimeout] = useState(1000);
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Result state
  const [result, setResult] = useState<TracerouteResult | null>(null);
  const [liveHops, setLiveHops] = useState<TracerouteHop[]>([]);
  const [isTracing, setIsTracing] = useState(false);
  const [history, setHistory] = useState<TracerouteHistoryEntry[]>([]);

  // SignalR
  const { isConnected, subscribeToTraceroute, traceroute: hubTraceroute } =
    useNetworkHub();

  // Input ref for focus
  const inputRef = useRef<HTMLInputElement>(null);

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
          toast.success(
            `Traceroute complete: ${traceResult.hops.length} hops to destination`
          );
        } else {
          toast.warning(
            `Traceroute incomplete: Destination not reached after ${traceResult.hops.length} hops`
          );
        }
      } else {
        // Fallback to REST API
        const traceResult = await tracerouteApi({
          host,
          maxHops,
          timeout,
        });
        setResult(traceResult);

        // Add to history
        const newEntry: TracerouteHistoryEntry = {
          id: crypto.randomUUID(),
          timestamp: new Date(),
          result: traceResult,
        };
        setHistory((prev) => [newEntry, ...prev].slice(0, 5));

        if (traceResult.reachedDestination) {
          toast.success(
            `Traceroute complete: ${traceResult.hops.length} hops to destination`
          );
        } else {
          toast.warning(
            `Traceroute incomplete: Destination not reached after ${traceResult.hops.length} hops`
          );
        }
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Traceroute request failed";
      toast.error(errorMessage);
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
    toast.info("Results cleared");
  }, []);

  // Export functions
  const handleExportText = useCallback(() => {
    if (!result) {
      toast.error("No data to export");
      return;
    }
    exportToText(result);
    toast.success("Exported to text file");
  }, [result]);

  const handleExportCSV = useCallback(() => {
    if (!result) {
      toast.error("No data to export");
      return;
    }
    exportToCSV(result);
    toast.success("Exported to CSV");
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
  const totalRtt =
    successfulHops.length > 0
      ? successfulHops.reduce((sum, h) => sum + h.roundtripTime, 0)
      : 0;
  const timeoutCount = displayHops.filter((h) => h.status === "TimedOut").length;

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Route className="h-5 w-5" />
            Traceroute
          </CardTitle>
          <CardDescription>
            Trace the network path to a remote host and visualize each hop along
            the route
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-[1fr_150px_150px_auto]">
            {/* Host Input */}
            <div className="space-y-2">
              <Label htmlFor="traceroute-host">Target Host</Label>
              <Input
                id="traceroute-host"
                ref={inputRef}
                placeholder="e.g., google.com or 8.8.8.8"
                value={host}
                onChange={(e) => handleHostChange(e.target.value)}
                onKeyDown={handleKeyDown}
                className={validationError ? "border-destructive" : ""}
                disabled={isLoading}
              />
              {validationError && (
                <p className="text-sm text-destructive">{validationError}</p>
              )}
            </div>

            {/* Max Hops Slider */}
            <div className="space-y-2">
              <Label>Max Hops: {maxHops}</Label>
              <Slider
                value={[maxHops]}
                onValueChange={(value) => {
                  const newValue = Array.isArray(value) ? value[0] : value;
                  setMaxHops(newValue);
                }}
                min={1}
                max={64}
                step={1}
                disabled={isLoading}
                className="mt-3"
              />
              <p className="text-xs text-muted-foreground">1 - 64</p>
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
                max={5000}
                step={100}
                disabled={isLoading}
                className="mt-3"
              />
              <p className="text-xs text-muted-foreground">100ms - 5000ms</p>
            </div>

            {/* Submit Button */}
            <div className="flex items-end">
              <Button
                onClick={handleTraceroute}
                disabled={isLoading || !host}
                className="w-full md:w-auto"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Tracing...
                  </>
                ) : (
                  <>
                    <Route className="mr-2 h-4 w-4" />
                    Trace
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Live Progress Indicator */}
      {isTracing && (
        <Card className="border-primary/50">
          <CardContent className="pt-6">
            <div className="flex items-center gap-4">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
              <div className="flex-1">
                <p className="text-sm font-medium">Tracing route to {host}...</p>
                <p className="text-sm text-muted-foreground">
                  {liveHops.length} hops discovered
                </p>
              </div>
              <Progress value={(liveHops.length / maxHops) * 100} className="w-32" />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Result Summary */}
      {result && (
        <Card
          className={`border-l-4 ${result.reachedDestination ? "border-l-green-500" : "border-l-yellow-500"}`}
        >
          <CardContent className="pt-6">
            <div className="grid gap-4 md:grid-cols-5">
              {/* Status */}
              <div className="flex items-center gap-3">
                {result.reachedDestination ? (
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                ) : (
                  <XCircle className="h-8 w-8 text-yellow-500" />
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge
                    variant={result.reachedDestination ? "default" : "secondary"}
                    className={result.reachedDestination ? "bg-green-500" : ""}
                  >
                    {result.reachedDestination
                      ? "Destination Reached"
                      : "Incomplete"}
                  </Badge>
                </div>
              </div>

              {/* Total Hops */}
              <div className="flex items-center gap-3">
                <MapPin className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Hops</p>
                  <p className="text-2xl font-bold">{result.hops.length}</p>
                </div>
              </div>

              {/* Average RTT */}
              <div className="flex items-center gap-3">
                <Timer className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Average RTT</p>
                  <p className={`text-2xl font-bold ${getRttColor(avgRtt)}`}>
                    {avgRtt}ms
                  </p>
                </div>
              </div>

              {/* Total Latency */}
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Total Latency</p>
                  <p className="text-2xl font-bold">{totalRtt}ms</p>
                </div>
              </div>

              {/* Timeouts */}
              <div className="flex items-center gap-3">
                <AlertCircle
                  className={`h-8 w-8 ${timeoutCount > 0 ? "text-yellow-500" : "text-muted-foreground"}`}
                />
                <div>
                  <p className="text-sm text-muted-foreground">Timeouts</p>
                  <p className="text-2xl font-bold">{timeoutCount}</p>
                </div>
              </div>
            </div>

            {/* Resolved Address */}
            {result.resolvedAddress && result.resolvedAddress !== result.hostname && (
              <div className="mt-4 pt-4 border-t flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Resolved IP:</span>
                <code className="px-2 py-1 bg-muted rounded font-mono">
                  {result.resolvedAddress}
                </code>
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => copyToClipboard(result.resolvedAddress!)}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Copy IP</TooltipContent>
                </Tooltip>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Hop-by-Hop Display */}
      {displayHops.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm flex items-center gap-2">
                <Route className="h-4 w-4" />
                Route Path ({displayHops.length} hops)
              </CardTitle>
              <div className="flex gap-2">
                {result && (
                  <>
                    <Tooltip>
                      <TooltipTrigger>
                        <Button variant="outline" size="sm" onClick={handleExportText}>
                          <Download className="h-4 w-4 mr-1" />
                          TXT
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export to Text</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger>
                        <Button variant="outline" size="sm" onClick={handleExportCSV}>
                          <Download className="h-4 w-4 mr-1" />
                          CSV
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Export to CSV</TooltipContent>
                    </Tooltip>
                  </>
                )}
                <Tooltip>
                  <TooltipTrigger>
                    <Button variant="outline" size="sm" onClick={handleClear}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear Results</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* Visual Route Path */}
            <div className="space-y-2">
              {displayHops.map((hop, index) => (
                <HopCard
                  key={`${hop.hopNumber}-${index}`}
                  hop={hop}
                  isDestination={
                    hop.status === "Success" && index === displayHops.length - 1
                  }
                  isFirst={index === 0}
                  maxRtt={maxRtt}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* History Section */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Recent Traceroutes</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {history.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center justify-between p-3 rounded-lg border hover:bg-muted/50 transition-colors cursor-pointer"
                  onClick={() => setResult(entry.result)}
                >
                  <div className="flex items-center gap-3">
                    <Route className="h-4 w-4 text-muted-foreground" />
                    <div>
                      <p className="font-medium text-sm">
                        {entry.result.hostname}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {formatTime(entry.timestamp)} • {entry.result.hops.length}{" "}
                        hops
                      </p>
                    </div>
                  </div>
                  <Badge
                    variant={
                      entry.result.reachedDestination ? "default" : "secondary"
                    }
                    className={
                      entry.result.reachedDestination ? "bg-green-500" : ""
                    }
                  >
                    {entry.result.reachedDestination ? "Complete" : "Incomplete"}
                  </Badge>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {displayHops.length === 0 && !result && !isTracing && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Route className="h-12 w-12 mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No traceroute results</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Enter a hostname or IP address above and click "Trace" to
              visualize the network path and measure latency at each hop.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
