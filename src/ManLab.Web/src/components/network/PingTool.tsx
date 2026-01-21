/**
 * PingTool Component
 * Network ping utility for checking host reachability and measuring latency.
 * Features:
 * - Input field for hostname/IP with validation
 * - Timeout configuration slider
 * - Ping button with loading state
 * - Result display with status badge, RTT, TTL, resolved IP
 * - Ping history table (last 10 pings)
 * - RTT chart over time
 * - Export results to CSV
 */

import { useState, useCallback, useRef } from "react";
import {
  Radio,
  Loader2,
  Download,
  Trash2,
  CheckCircle2,
  XCircle,
  Clock,
  MapPin,
  Timer,
  Activity,
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";
import { toast } from "sonner";
import { pingHost, type PingResult } from "@/api/networkApi";

// ============================================================================
// Types
// ============================================================================

interface PingHistoryEntry extends PingResult {
  id: string;
  timestamp: Date;
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
  if (rtt < 50) return "text-green-500";
  if (rtt < 100) return "text-yellow-500";
  if (rtt < 200) return "text-orange-500";
  return "text-red-500";
}

/**
 * Export ping history to CSV
 */
function exportToCSV(history: PingHistoryEntry[]): void {
  const headers = [
    "Timestamp",
    "Host",
    "Resolved IP",
    "Status",
    "RTT (ms)",
    "TTL",
  ];
  const rows = history.map((entry) => [
    entry.timestamp.toISOString(),
    entry.address,
    entry.resolvedAddress || "",
    entry.isSuccess ? "Success" : entry.status,
    entry.isSuccess ? entry.roundtripTime.toString() : "",
    entry.ttl?.toString() || "",
  ]);

  const csvContent = [
    headers.join(","),
    ...rows.map((row) => row.map((cell) => `"${cell}"`).join(",")),
  ].join("\n");

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `ping-results-${new Date().toISOString().slice(0, 10)}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// ============================================================================
// Component
// ============================================================================

export function PingTool() {
  // Form state
  const [host, setHost] = useState("");
  const [timeout, setTimeout] = useState(1000);
  const [isLoading, setIsLoading] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  // Result state
  const [lastResult, setLastResult] = useState<PingResult | null>(null);
  const [history, setHistory] = useState<PingHistoryEntry[]>([]);

  // Input ref for focus
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle input change with validation
  const handleHostChange = useCallback((value: string) => {
    setHost(value);
    if (value && !isValidHost(value)) {
      setValidationError("Please enter a valid hostname or IP address");
    } else {
      setValidationError(null);
    }
  }, []);

  // Handle ping submission
  const handlePing = useCallback(async () => {
    if (!host || !isValidHost(host)) {
      setValidationError("Please enter a valid hostname or IP address");
      inputRef.current?.focus();
      return;
    }

    setIsLoading(true);
    setValidationError(null);

    try {
      const result = await pingHost({ host, timeout });
      setLastResult(result);

      // Add to history (keep last 10)
      const newEntry: PingHistoryEntry = {
        ...result,
        id: crypto.randomUUID(),
        timestamp: new Date(),
      };
      setHistory((prev) => [newEntry, ...prev].slice(0, 10));

      if (result.isSuccess) {
        toast.success(`Ping successful: ${result.roundtripTime}ms`);
      } else {
        toast.error(`Ping failed: ${result.status}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Ping request failed";
      toast.error(errorMessage);
      setLastResult(null);
    } finally {
      setIsLoading(false);
    }
  }, [host, timeout]);

  // Handle Enter key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isLoading) {
        handlePing();
      }
    },
    [handlePing, isLoading]
  );

  // Clear history
  const handleClearHistory = useCallback(() => {
    setHistory([]);
    setLastResult(null);
    toast.info("Ping history cleared");
  }, []);

  // Export to CSV
  const handleExport = useCallback(() => {
    if (history.length === 0) {
      toast.error("No data to export");
      return;
    }
    exportToCSV(history);
    toast.success("Exported to CSV");
  }, [history]);

  // Prepare chart data
  const chartData = [...history]
    .reverse()
    .filter((entry) => entry.isSuccess)
    .map((entry) => ({
      time: formatTime(entry.timestamp),
      rtt: entry.roundtripTime,
    }));

  // Calculate stats
  const successfulPings = history.filter((h) => h.isSuccess);
  const avgRtt =
    successfulPings.length > 0
      ? Math.round(
          successfulPings.reduce((sum, h) => sum + h.roundtripTime, 0) /
            successfulPings.length
        )
      : 0;
  const minRtt =
    successfulPings.length > 0
      ? Math.min(...successfulPings.map((h) => h.roundtripTime))
      : 0;
  const maxRtt =
    successfulPings.length > 0
      ? Math.max(...successfulPings.map((h) => h.roundtripTime))
      : 0;
  const successRate =
    history.length > 0
      ? Math.round((successfulPings.length / history.length) * 100)
      : 100;

  return (
    <div className="space-y-6">
      {/* Input Section */}
      <Card>
        <CardHeader className="pb-4">
          <CardTitle className="text-lg flex items-center gap-2">
            <Radio className="h-5 w-5" />
            Ping Host
          </CardTitle>
          <CardDescription>
            Check if a host is reachable and measure round-trip latency
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-6 md:grid-cols-[1fr_200px_auto]">
            {/* Host Input */}
            <div className="space-y-2">
              <Label htmlFor="ping-host">Hostname or IP Address</Label>
              <Input
                id="ping-host"
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
                onClick={handlePing}
                disabled={isLoading || !host}
                className="w-full md:w-auto"
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Pinging...
                  </>
                ) : (
                  <>
                    <Radio className="mr-2 h-4 w-4" />
                    Ping
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Last Result Display */}
      {lastResult && (
        <Card
          className={`border-l-4 ${lastResult.isSuccess ? "border-l-green-500" : "border-l-red-500"}`}
        >
          <CardContent className="pt-6">
            <div className="grid gap-4 md:grid-cols-4">
              {/* Status */}
              <div className="flex items-center gap-3">
                {lastResult.isSuccess ? (
                  <CheckCircle2 className="h-8 w-8 text-green-500" />
                ) : (
                  <XCircle className="h-8 w-8 text-red-500" />
                )}
                <div>
                  <p className="text-sm text-muted-foreground">Status</p>
                  <Badge
                    variant={lastResult.isSuccess ? "default" : "destructive"}
                  >
                    {lastResult.isSuccess ? "Success" : lastResult.status}
                  </Badge>
                </div>
              </div>

              {/* RTT */}
              <div className="flex items-center gap-3">
                <Timer className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">
                    Round-Trip Time
                  </p>
                  <p
                    className={`text-2xl font-bold ${lastResult.isSuccess ? getRttColor(lastResult.roundtripTime) : "text-muted-foreground"}`}
                  >
                    {lastResult.isSuccess
                      ? `${lastResult.roundtripTime}ms`
                      : "—"}
                  </p>
                </div>
              </div>

              {/* TTL */}
              <div className="flex items-center gap-3">
                <Clock className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">TTL</p>
                  <p className="text-2xl font-bold">
                    {lastResult.ttl ?? "—"}
                  </p>
                </div>
              </div>

              {/* Resolved IP */}
              <div className="flex items-center gap-3">
                <MapPin className="h-8 w-8 text-primary" />
                <div>
                  <p className="text-sm text-muted-foreground">Resolved IP</p>
                  <p className="text-lg font-mono">
                    {lastResult.resolvedAddress || lastResult.address}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats and Chart Row */}
      {history.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
          {/* Statistics Card */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Statistics
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-xs text-muted-foreground">Average RTT</p>
                  <p className="text-xl font-bold">{avgRtt}ms</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Success Rate</p>
                  <p
                    className={`text-xl font-bold ${successRate === 100 ? "text-green-500" : successRate >= 80 ? "text-yellow-500" : "text-red-500"}`}
                  >
                    {successRate}%
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Min RTT</p>
                  <p className="text-lg font-medium text-green-500">
                    {minRtt}ms
                  </p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Max RTT</p>
                  <p className="text-lg font-medium text-orange-500">
                    {maxRtt}ms
                  </p>
                </div>
              </div>
              <div className="border-t pt-4">
                <p className="text-xs text-muted-foreground mb-1">
                  Total Pings
                </p>
                <p className="text-lg font-medium">
                  {history.length}{" "}
                  <span className="text-sm text-muted-foreground">
                    ({successfulPings.length} successful)
                  </span>
                </p>
              </div>
            </CardContent>
          </Card>

          {/* RTT Chart */}
          {chartData.length > 1 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">RTT over Time</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart data={chartData}>
                    <CartesianGrid
                      strokeDasharray="3 3"
                      className="stroke-muted"
                    />
                    <XAxis
                      dataKey="time"
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      className="fill-muted-foreground"
                    />
                    <YAxis
                      tick={{ fontSize: 12 }}
                      tickLine={false}
                      className="fill-muted-foreground"
                      label={{
                        value: "ms",
                        angle: -90,
                        position: "insideLeft",
                        fontSize: 12,
                      }}
                    />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "hsl(var(--card))",
                        border: "1px solid hsl(var(--border))",
                        borderRadius: "0.5rem",
                      }}
                      labelStyle={{ color: "hsl(var(--foreground))" }}
                    />
                    {avgRtt > 0 && (
                      <ReferenceLine
                        y={avgRtt}
                        stroke="hsl(var(--muted-foreground))"
                        strokeDasharray="5 5"
                        label={{
                          value: `Avg: ${avgRtt}ms`,
                          position: "insideTopRight",
                          fontSize: 10,
                          fill: "hsl(var(--muted-foreground))",
                        }}
                      />
                    )}
                    <Line
                      type="monotone"
                      dataKey="rtt"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{
                        fill: "hsl(var(--primary))",
                        strokeWidth: 2,
                        r: 4,
                      }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* History Table */}
      {history.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm">Ping History</CardTitle>
              <div className="flex gap-2">
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleExport}
                    >
                      <Download className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Export to CSV</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleClearHistory}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Clear History</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Host</TableHead>
                  <TableHead>Resolved IP</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">RTT</TableHead>
                  <TableHead className="text-right">TTL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="font-mono text-sm">
                      {formatTime(entry.timestamp)}
                    </TableCell>
                    <TableCell>{entry.address}</TableCell>
                    <TableCell className="font-mono text-sm">
                      {entry.resolvedAddress || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={entry.isSuccess ? "default" : "destructive"}
                        className="text-xs"
                      >
                        {entry.isSuccess ? "Success" : entry.status}
                      </Badge>
                    </TableCell>
                    <TableCell
                      className={`text-right font-mono ${entry.isSuccess ? getRttColor(entry.roundtripTime) : "text-muted-foreground"}`}
                    >
                      {entry.isSuccess ? `${entry.roundtripTime}ms` : "—"}
                    </TableCell>
                    <TableCell className="text-right font-mono">
                      {entry.ttl ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Empty State */}
      {history.length === 0 && !lastResult && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center">
            <Radio className="h-12 w-12 mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-medium mb-2">No ping results yet</h3>
            <p className="text-sm text-muted-foreground max-w-sm">
              Enter a hostname or IP address above and click "Ping" to check
              connectivity and measure latency.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
