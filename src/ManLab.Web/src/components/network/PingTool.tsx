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

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Play,
  Square,
  Timer,
  Wifi,
  History,
  Trash2,
  Download,
  AlertCircle,
  Activity,
  ArrowUp,
  ArrowDown,
  Minus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
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
import { Skeleton } from "@/components/ui/skeleton";
import { notify } from "@/lib/network-notify";
import { pingHost, recordPingAggregateHistory, updatePingAggregateHistory, type PingResult } from "@/api/networkApi";
import { StatusBadge } from "@/components/network/StatusIndicators";
import { announce } from "@/lib/accessibility";
import { useNetworkToolsOptional } from "@/hooks/useNetworkTools";
import { motion, AnimatePresence } from "framer-motion";
import { cn, generateId } from "@/lib/utils";

const PingRttChart = lazy(() => import("@/components/network/PingRttChart"));

// ============================================================================
// Types
// ============================================================================

interface PingHistoryEntry extends PingResult {
  id: string;
  timestamp: Date;
}

interface AggregatedPingEntry {
  timeWindow: Date;
  avgRtt: number;
  minRtt: number;
  maxRtt: number;
  totalPings: number;
  successfulPings: number;
}

const PING_HOST_KEY = "manlab:network:ping-host";
const PING_TIMEOUT_KEY = "manlab:network:ping-timeout";
const MAX_HISTORY_ENTRIES = 10;
const MAX_AGGREGATED_ENTRIES = 300; // Store up to 5 minutes of aggregated data (300 seconds)

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
 * Aggregate ping data into time windows for performance optimization
 * In infinite mode, we aggregate pings per second rather than storing each individual ping
 */
function aggregatePing(
  aggregatedData: AggregatedPingEntry[],
  currentWindowPings: number[],
  windowStart: Date
): { aggregatedData: AggregatedPingEntry[]; entry: AggregatedPingEntry | null } {
  // The windowStart is already truncated to seconds from the caller

  // If window changed or no current window, commit previous data
  let updatedAggregatedData = [...aggregatedData];
  let committedEntry: AggregatedPingEntry | null = null;

  if (currentWindowPings.length > 0) {
    const avgRtt = Math.round(
      currentWindowPings.reduce((sum, rtt) => sum + rtt, 0) / currentWindowPings.length
    );
    const minRtt = Math.min(...currentWindowPings);
    const maxRtt = Math.max(...currentWindowPings);

    const entry: AggregatedPingEntry = {
      timeWindow: windowStart,
      avgRtt,
      minRtt,
      maxRtt,
      totalPings: currentWindowPings.length,
      successfulPings: currentWindowPings.length,
    };

    committedEntry = entry;
    updatedAggregatedData = [...updatedAggregatedData, entry];

    // Limit array size for performance (FIFO)
    if (updatedAggregatedData.length > MAX_AGGREGATED_ENTRIES) {
      updatedAggregatedData = updatedAggregatedData.slice(-MAX_AGGREGATED_ENTRIES);
    }
  }

  return {
    aggregatedData: updatedAggregatedData,
    entry: committedEntry,
  };
}

function createAggregatedHistoryEntry(
  entry: AggregatedPingEntry,
  host: string,
  referenceResult: PingResult | null
): PingHistoryEntry {
  return {
    id: generateId(),
    timestamp: entry.timeWindow,
    address: host,
    resolvedAddress: referenceResult?.resolvedAddress ?? null,
    status: "Aggregated",
    roundtripTime: entry.avgRtt,
    ttl: referenceResult?.ttl ?? null,
    isSuccess: true,
  };
}

function summarizeAggregatedData(
  entries: AggregatedPingEntry[]
): Omit<AggregatedPingEntry, "timeWindow"> | null {
  if (entries.length === 0) return null;

  const totalPings = entries.reduce((sum, e) => sum + e.totalPings, 0);
  if (totalPings === 0) return null;

  const successfulPings = entries.reduce((sum, e) => sum + e.successfulPings, 0);
  const avgRtt = Math.round(
    entries.reduce((sum, e) => sum + e.avgRtt * e.totalPings, 0) / totalPings
  );
  const minRtt = Math.min(...entries.map((e) => e.minRtt));
  const maxRtt = Math.max(...entries.map((e) => e.maxRtt));

  return {
    avgRtt,
    minRtt,
    maxRtt,
    totalPings,
    successfulPings,
  };
}

function buildAggregatedEntryFromWindow(
  pings: number[],
  windowStart: Date
): AggregatedPingEntry | null {
  if (pings.length === 0) return null;
  const avgRtt = Math.round(pings.reduce((sum, rtt) => sum + rtt, 0) / pings.length);
  const minRtt = Math.min(...pings);
  const maxRtt = Math.max(...pings);

  return {
    timeWindow: windowStart,
    avgRtt,
    minRtt,
    maxRtt,
    totalPings: pings.length,
    successfulPings: pings.length,
  };
}

function summarizeAggregatedSnapshot(
  aggregatedData: AggregatedPingEntry[],
  currentWindowPings: number[],
  currentWindowStart: Date | null
): Omit<AggregatedPingEntry, "timeWindow"> | null {
  const entries = [...aggregatedData];
  if (currentWindowPings.length > 0) {
    const windowStart = currentWindowStart ?? new Date();
    const currentEntry = buildAggregatedEntryFromWindow(currentWindowPings, windowStart);
    if (currentEntry) entries.push(currentEntry);
  }

  return summarizeAggregatedData(entries);
}

// ============================================================================
// Component
// ============================================================================

export function PingTool() {
  // Network tools context for quick actions
  const networkTools = useNetworkToolsOptional();

  // Form state
  const [host, setHost] = useState(() => getStoredString(PING_HOST_KEY, ""));
  const [timeout, setTimeout] = useState(() => getStoredNumber(PING_TIMEOUT_KEY, 1000));
  const [isLoading, setIsLoading] = useState(false);
  const [isContinuous, setIsContinuous] = useState(false);
  const [isContinuousRunning, setIsContinuousRunning] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [rateLimitMessage, setRateLimitMessage] = useState<string | null>(null);
  const [tick, setTick] = useState(0); // Force re-render for ref updates

  // Result state
  const [lastResult, setLastResult] = useState<PingResult | null>(null);
  const [history, setHistory] = useState<PingHistoryEntry[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const continuousRef = useRef(false);
  const continuousHistoryIdRef = useRef<string | null>(null);
  const continuousPingCountRef = useRef(0);
  
  // Aggregated data for infinite mode (performance optimized)
  const aggregatedDataRef = useRef<AggregatedPingEntry[]>([]);
  const currentAggregationWindowRef = useRef<Date | null>(null);
  const currentWindowPingsRef = useRef<number[]>([]);

  // Track previous RTT for diff calculation
  const latestRttRef = useRef<number | null>(null);
  const [rttDiff, setRttDiff] = useState<number | null>(null);

  // Input ref for focus
  const inputRef = useRef<HTMLInputElement>(null);

  // Handle pending action from context (e.g., quick ping from HostCard)
  useEffect(() => {
    if (
      networkTools?.pendingAction?.type === "ping" &&
      networkTools.pendingAction.target
    ) {
      const target = networkTools.pendingAction.target;
      setHost(target);
      setValidationError(null);
      networkTools.clearPendingAction();
      // Focus the input after setting the host
      globalThis.setTimeout(() => {
        inputRef.current?.focus();
        notify.info(`Ready to ping ${target}`);
      }, 100);
    }
  }, [networkTools, networkTools?.pendingAction]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(PING_HOST_KEY, host);
    localStorage.setItem(PING_TIMEOUT_KEY, String(timeout));
  }, [host, timeout]);

  useEffect(() => {
    return () => {
      continuousRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // Handle input change with validation
  const handleHostChange = useCallback((value: string) => {
    setHost(value);
    if (value && !isValidHost(value)) {
      setValidationError("Please enter a valid hostname or IP address");
    } else {
      setValidationError(null);
    }
    // Reset comparison when host changes
    latestRttRef.current = null;
    setRttDiff(null);
  }, []);

  // Handle ping submission
  const performPing = useCallback(async (
    notifyUser: boolean,
    options?: { recordHistory?: boolean }
  ) => {
    if (!host || !isValidHost(host)) {
      setValidationError("Please enter a valid hostname or IP address");
      inputRef.current?.focus();
      return false;
    }

    setLastResult(null);
    setIsLoading(true);
    setValidationError(null);
    setRateLimitMessage(null);

    try {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const result = await pingHost(
        { host, timeout, recordHistory: options?.recordHistory ?? true },
        { signal: controller.signal }
      );
      setLastResult(result);

      const currentTime = new Date();
      
      // In continuous mode, use aggregated data for performance
      if (isContinuous) {
        continuousPingCountRef.current += 1;
        const windowStart = new Date(currentTime);
        windowStart.setMilliseconds(0);

        // Check if we've moved to a new aggregation window
        if (
          currentAggregationWindowRef.current &&
          currentAggregationWindowRef.current.getTime() !== windowStart.getTime()
        ) {
          // Commit the previous window's data
          const { aggregatedData: newData } = aggregatePing(
            aggregatedDataRef.current,
            currentWindowPingsRef.current,
            currentAggregationWindowRef.current
          );
          aggregatedDataRef.current = newData;
          currentWindowPingsRef.current = [];
          currentAggregationWindowRef.current = windowStart;
          setTick(t => t + 1);
        } else if (!currentAggregationWindowRef.current) {
          currentAggregationWindowRef.current = windowStart;
        }

        // Add current ping to window
        if (result.isSuccess) {
          currentWindowPingsRef.current.push(result.roundtripTime);
        }

        if (continuousPingCountRef.current % 10 === 0) {
          const summary = summarizeAggregatedSnapshot(
            aggregatedDataRef.current,
            currentWindowPingsRef.current,
            currentAggregationWindowRef.current
          );

          if (summary) {
            const request = {
              host,
              timeout,
              windowStartUtc: new Date().toISOString(),
              avgRtt: summary.avgRtt,
              minRtt: summary.minRtt,
              maxRtt: summary.maxRtt,
              totalPings: summary.totalPings,
              successfulPings: summary.successfulPings,
              resolvedAddress: result.resolvedAddress ?? null,
              ttl: result.ttl ?? null,
            };

            if (continuousHistoryIdRef.current) {
              void updatePingAggregateHistory(continuousHistoryIdRef.current, request);
            } else {
              void recordPingAggregateHistory(request).then(({ id }) => {
                continuousHistoryIdRef.current = id;
              });
            }
          }
        }
      } else {
        // Single ping mode: add to history (keep last 10)
        const newEntry: PingHistoryEntry = {
          ...result,
          id: generateId(),
          timestamp: currentTime,
        };
        setHistory((prev) => [newEntry, ...prev].slice(0, MAX_HISTORY_ENTRIES));
      }

      if (result.isSuccess) {
        if (latestRttRef.current !== null) {
          setRttDiff(result.roundtripTime - latestRttRef.current);
        } else {
          setRttDiff(null);
        }
        latestRttRef.current = result.roundtripTime;
      } else {
        setRttDiff(null);
      }

      if (notifyUser) {
        if (result.isSuccess) {
          notify.success(`Ping successful: ${result.roundtripTime}ms`);
          announce(
            `Ping to ${host} successful. Round trip time: ${result.roundtripTime} milliseconds`,
            "polite"
          );
        } else {
          notify.error(`Ping failed: ${result.status}`);
          announce(`Ping to ${host} failed. Status: ${result.status}`, "assertive");
        }
      }
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return false;
      }
      const errorMessage =
        error instanceof Error ? error.message : "Ping request failed";
      if (errorMessage.toLowerCase().includes("rate") || errorMessage.includes("429")) {
        setRateLimitMessage("Rate limit reached. Please wait before retrying.");
      }
      if (notifyUser) {
        notify.error(errorMessage);
      }
      setLastResult(null);
      return false;
    } finally {
      setIsLoading(false);
    }
  }, [host, timeout, isContinuous]);

  const stopContinuous = useCallback(() => {
    continuousRef.current = false;
    abortRef.current?.abort();
    
    // Commit any remaining aggregated data
    if (currentWindowPingsRef.current.length > 0 && currentAggregationWindowRef.current) {
      const { aggregatedData: newData } = aggregatePing(
        aggregatedDataRef.current,
        currentWindowPingsRef.current,
        currentAggregationWindowRef.current
      );
      aggregatedDataRef.current = newData;
      currentWindowPingsRef.current = [];
      currentAggregationWindowRef.current = null;
    }

    const summary = summarizeAggregatedSnapshot(
      aggregatedDataRef.current,
      currentWindowPingsRef.current,
      currentAggregationWindowRef.current
    );
    if (summary) {
      const historyEntry = createAggregatedHistoryEntry(
        { timeWindow: new Date(), ...summary },
        host,
        lastResult
      );
      setHistory((prev) => [historyEntry, ...prev].slice(0, MAX_HISTORY_ENTRIES));
      const request = {
        host,
        timeout,
        windowStartUtc: historyEntry.timestamp.toISOString(),
        avgRtt: summary.avgRtt,
        minRtt: summary.minRtt,
        maxRtt: summary.maxRtt,
        totalPings: summary.totalPings,
        successfulPings: summary.successfulPings,
        resolvedAddress: lastResult?.resolvedAddress ?? null,
        ttl: lastResult?.ttl ?? null,
      };

      if (continuousHistoryIdRef.current) {
        void updatePingAggregateHistory(continuousHistoryIdRef.current, request);
      } else {
        void recordPingAggregateHistory(request).then(({ id }) => {
          continuousHistoryIdRef.current = id;
        });
      }
    }
    
    setIsContinuousRunning(false);
  }, [host, lastResult, timeout]);

  const startContinuous = useCallback(async () => {
    if (isContinuousRunning) return;

    // Reset aggregated data on fresh start
    aggregatedDataRef.current = [];
    currentAggregationWindowRef.current = null;
    currentWindowPingsRef.current = [];
    continuousHistoryIdRef.current = null;
    continuousPingCountRef.current = 0;
    setTick(0);

    continuousRef.current = true;
    setIsContinuousRunning(true);

    while (continuousRef.current) {
      await performPing(false, { recordHistory: false });
      await new Promise<void>((resolve) => {
        globalThis.setTimeout(() => resolve(), 1000);
      });
    }

    setIsContinuousRunning(false);
  }, [isContinuousRunning, performPing]);

  const handlePing = useCallback(async () => {
    // If running continuous or just loading (single ping), treat as stop/cancel
    if (isContinuousRunning || isLoading) {
      stopContinuous();
      return;
    }

    if (isContinuous) {
      await startContinuous();
      return;
    }

    await performPing(true, { recordHistory: true });
  }, [isContinuous, isContinuousRunning, isLoading, performPing, startContinuous, stopContinuous]);

  // Handle Enter key press
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isLoading && !isContinuousRunning) {
        handlePing();
      }
    },
    [handlePing, isLoading, isContinuousRunning]
  );

  // Clear history
  const handleClearHistory = useCallback(() => {
    setHistory([]);
    setLastResult(null);
    latestRttRef.current = null;
    setRttDiff(null);
    notify.info("Ping history cleared");
    announce("Ping history cleared", "polite");
  }, []);

  // Export to CSV
  const handleExport = useCallback(() => {
    if (history.length === 0) {
      notify.error("No data to export");
      return;
    }
    exportToCSV(history);
    notify.success("Exported to CSV");
  }, [history]);

  // Prepare chart data - use aggregated data in continuous mode, individual pings otherwise
  const successfulPings = useMemo(
    () => history.filter((entry) => entry.isSuccess),
    [history]
  );

  const chartData = useMemo(() => {
    if (isContinuous && aggregatedDataRef.current.length > 0) {
      // Use aggregated data from continuous mode (performance optimized)
      return aggregatedDataRef.current.map((entry) => ({
        time: formatTime(entry.timeWindow),
        rtt: entry.avgRtt,
        minRtt: entry.minRtt,
        maxRtt: entry.maxRtt,
      }));
    }
    
    // Use individual ping data for single ping mode
    return [...successfulPings]
      .reverse()
      .map((entry) => ({
        time: formatTime(entry.timestamp),
        rtt: entry.roundtripTime,
        minRtt: entry.roundtripTime,
        maxRtt: entry.roundtripTime,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContinuous, successfulPings, tick]);

  const stats = useMemo(() => {
    if (isContinuous && aggregatedDataRef.current.length > 0) {
      // Calculate stats from aggregated data
      const aggregated = aggregatedDataRef.current;
      const avg = Math.round(
        aggregated.reduce((sum, h) => sum + h.avgRtt * h.totalPings, 0) /
          aggregated.reduce((sum, h) => sum + h.totalPings, 0)
      );
      const min = Math.min(...aggregated.map((h) => h.minRtt));
      const max = Math.max(...aggregated.map((h) => h.maxRtt));
      const totalPings = aggregated.reduce((sum, h) => sum + h.totalPings, 0);
      const successfulPingsTotal = aggregated.reduce((sum, h) => sum + h.successfulPings, 0);
      const successRateValue = totalPings > 0
        ? Math.round((successfulPingsTotal / totalPings) * 100)
        : 100;

      return {
        avgRtt: avg,
        minRtt: min,
        maxRtt: max,
        successRate: successRateValue,
      };
    }
    
    // Calculate stats from history for single ping mode
    const avg = successfulPings.length > 0
        ? Math.round(
            successfulPings.reduce((sum, h) => sum + h.roundtripTime, 0) /
              successfulPings.length
          )
        : 0;

    const min =
      successfulPings.length > 0
        ? Math.min(...successfulPings.map((h) => h.roundtripTime))
        : 0;

    const max =
      successfulPings.length > 0
        ? Math.max(...successfulPings.map((h) => h.roundtripTime))
        : 0;

    const successRateValue =
      history.length > 0
        ? Math.round((successfulPings.length / history.length) * 100)
        : 100;

    return {
      avgRtt: avg,
      minRtt: min,
      maxRtt: max,
      successRate: successRateValue,
      isSuccess: successfulPings.length > 0
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isContinuous, history, successfulPings, tick]);

  const isFormDisabled = isContinuousRunning; // Only disable inputs in continuous mode

  // Animation variants
  const containerVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeInOut" as const } },
  };

  return (
    <motion.div
      initial="hidden"
      animate="visible"
      variants={containerVariants}
      className="space-y-6 max-w-4xl mx-auto"
    >
      {/* Search Header */}
      <div className="relative flex items-center gap-2">
        <div className="relative flex-1">
          <Input
            id="ping-host"
            ref={inputRef}
            placeholder="Enter hostname or IP (e.g., google.com)"
            value={host}
            onChange={(e) => handleHostChange(e.target.value)}
            onKeyDown={handleKeyDown}
            className={cn(
              "h-14 pl-12 text-lg font-medium shadow-sm transition-all focus-visible:ring-2 bg-card/50 backdrop-blur-sm border-muted-foreground/20",
              validationError ? "border-destructive focus-visible:ring-destructive/30" : ""
            )}
            disabled={isFormDisabled}
          />
          <div className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground">
            {isLoading || isContinuousRunning ? (
              <Activity className="h-5 w-5 animate-pulse text-primary" />
            ) : (
              <Wifi className="h-5 w-5" />
            )}
          </div>
        </div>

        <Button
          size="lg"
          onClick={handlePing}
          disabled={!host} // Allow cancelling even if loading
          className={cn(
            "h-14 px-8 text-base font-semibold shadow-md transition-all",
            (isContinuousRunning || isLoading) ? "bg-destructive hover:bg-destructive/90 text-destructive-foreground" : ""
          )}
        >
          {isContinuousRunning ? (
            <span className="flex items-center gap-2"><Square className="h-4 w-4 fill-current" /> Stop</span>
          ) : isLoading ? (
            <span className="flex items-center gap-2"><Square className="h-4 w-4 fill-current" /> Cancel</span>
          ) : (
            <span className="flex items-center gap-2"><Play className="h-4 w-4 fill-current" /> Ping</span>
          )}
        </Button>
      </div>

      {validationError && (
        <motion.p
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="text-sm font-medium text-destructive px-1"
        >
          {validationError}
        </motion.p>
      )}

      {/* Control Bar */}
      <div className="flex flex-wrap items-center gap-6 px-4 py-3 rounded-lg border bg-card/30 backdrop-blur-sm text-sm">
        <div className="flex items-center gap-3">
          <span className="text-muted-foreground font-medium flex items-center gap-2">
            <Timer className="h-4 w-4" /> Timeout
          </span>
          <div className="flex items-center gap-3 w-45">
            <Slider
              value={[timeout]}
              onValueChange={(v) => {
                const val = Array.isArray(v) ? v[0] : v; 
                setTimeout(Number(val));
              }}
              min={100}
              max={5000}
              step={100}
              disabled={isFormDisabled}
              className="flex-1"
            />
            <span className="font-mono text-xs w-11.25 text-right">{timeout}ms</span>
          </div>
        </div>

        <div className="h-4 w-px bg-border hidden sm:block" />

        <div className="flex items-center gap-3">
          <Label htmlFor="ping-continuous" className="text-muted-foreground font-medium cursor-pointer">
            Infinite Mode
          </Label>
          <Switch
            id="ping-continuous"
            checked={isContinuous}
            onCheckedChange={(checked) => {
               setIsContinuous(checked);
               if (!checked && isContinuousRunning) stopContinuous();
            }}
            disabled={isLoading}
          />
        </div>
        
        <div className="flex-1" />
        
        {history.length > 0 && (
            <div className="flex items-center gap-1">
                 <Button variant="ghost" size="sm" onClick={handleExport} className="text-muted-foreground hover:text-foreground">
                    <Download className="h-4 w-4 mr-2" /> CSV
                 </Button>
                  <Button variant="ghost" size="sm" onClick={handleClearHistory} className="text-muted-foreground hover:text-destructive">
                    <Trash2 className="h-4 w-4 mr-2" /> Clear
                 </Button>
            </div>
        )}
      </div>

      {rateLimitMessage && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="p-4 rounded-lg bg-orange-500/10 border border-orange-500/20 flex items-center gap-3 text-orange-600 dark:text-orange-400"
        >
          <AlertCircle className="h-5 w-5" />
          <p className="text-sm font-medium">{rateLimitMessage}</p>
        </motion.div>
      )}

      {/* Main Results Grid */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Left Column: Live Status & Chart */}
        <div className="space-y-6">
          <AnimatePresence mode="wait">
            {lastResult ? (
              <motion.div
                key="result"
                layout
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
              >
                  <Card className={cn(
                      "relative overflow-hidden border-2 transition-colors",
                      lastResult.isSuccess ? "border-green-500/20 hover:border-green-500/40" : "border-red-500/20 hover:border-red-500/40"
                  )}>
                    <div className="absolute inset-0 bg-linear-to-br from-background via-transparent to-muted/10" />
                    <CardContent className="relative p-6">
                        <div className="flex items-start justify-between mb-8">
                            <div>
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Status</h3>
                                <StatusBadge
                                    status={lastResult.isSuccess ? "success" : "error"}
                                    label={lastResult.isSuccess ? "Active" : lastResult.status}
                                    className="text-base py-1 px-3"
                                />
                            </div>
                            <div className="text-right">
                                <h3 className="text-sm font-medium text-muted-foreground uppercase tracking-wider mb-1">Latency</h3>
                                  <div className="flex items-baseline justify-end gap-1">
                                    <span className={cn("text-4xl font-bold tracking-tight", lastResult.isSuccess ? getRttColor(lastResult.roundtripTime) : "text-muted-foreground")}>
                                      {lastResult.isSuccess ? lastResult.roundtripTime : "—"}
                                    </span>
                                    <span className="text-sm text-muted-foreground">ms</span>
                                  </div>
                                  {rttDiff !== null && (
                                    <div className="flex items-center justify-end gap-1 text-xs font-medium mt-1">
                                      {rttDiff > 0 ? (
                                        <ArrowUp className="h-3 w-3 text-red-500" />
                                      ) : rttDiff < 0 ? (
                                        <ArrowDown className="h-3 w-3 text-green-500" />
                                      ) : (
                                        <Minus className="h-3 w-3 text-muted-foreground" />
                                      )}
                                      <span className={cn(
                                        rttDiff > 0 ? "text-red-500" : rttDiff < 0 ? "text-green-500" : "text-muted-foreground"
                                      )}>
                                        {Math.abs(rttDiff)}ms
                                      </span>
                                    </div>
                                  )}
                            </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-4">
                             <div className="p-3 bg-muted/30 rounded-lg">
                                 <p className="text-xs text-muted-foreground mb-1">IP Address</p>
                                 <p className="font-mono text-sm">{lastResult.resolvedAddress || lastResult.address}</p>
                             </div>
                             <div className="p-3 bg-muted/30 rounded-lg">
                                 <p className="text-xs text-muted-foreground mb-1">TTL</p>
                                 <p className="font-mono text-sm">{lastResult.ttl?.toString() ?? "—"}</p>
                             </div>
                        </div>
                    </CardContent>
                  </Card>
              </motion.div>
            ) : isLoading ? (
               <motion.div key="skeleton" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                     <Card>
                         <CardContent className="p-6">
                             <div className="flex justify-between mb-8">
                                 <div className="space-y-2">
                                     <Skeleton className="h-4 w-12" />
                                     <Skeleton className="h-8 w-24" />
                                 </div>
                                 <div className="space-y-2 items-end flex flex-col">
                                     <Skeleton className="h-4 w-16" />
                                     <Skeleton className="h-10 w-32" />
                                 </div>
                             </div>
                             <div className="grid grid-cols-2 gap-4">
                                 <Skeleton className="h-12 w-full" />
                                 <Skeleton className="h-12 w-full" />
                             </div>
                         </CardContent>
                     </Card>
               </motion.div>
            ) : (
                <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                    <Card className="border-dashed">
                        <CardContent className="p-12 text-center text-muted-foreground">
                            <Wifi className="h-12 w-12 mx-auto mb-4 opacity-20" />
                            <p>Enter a host to start pinging</p>
                        </CardContent>
                    </Card>
                </motion.div>
            )}
          </AnimatePresence>

            {/* Chart Section */}
            {(history.length > 0 || isContinuous) && (
                <Card className="border-none shadow-none bg-transparent">
                  <CardHeader className="px-0 pt-0">
                    <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                      <Activity className="h-4 w-4" /> Latency History
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="px-0 pb-0">
                    <Suspense fallback={<Skeleton className="h-50 w-full" />}>
                      <PingRttChart data={chartData} avgRtt={stats.avgRtt} />
                    </Suspense>
                  </CardContent>
                </Card>
            )}
        </div>

        {/* Right Column: Statistics & History */}
        <div className="space-y-6">
             {/* Statistics Grid */}
             <div className="grid grid-cols-2 gap-4">
                 <Card className="bg-primary/5 border-primary/10">
                    <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">Avg Latency</p>
                        <p className="text-2xl font-bold tracking-tight">{stats.avgRtt}<span className="text-sm font-normal text-muted-foreground ml-1">ms</span></p>
                    </CardContent>
                 </Card>
                 <Card className="bg-primary/5 border-primary/10">
                    <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">Success Rate</p>
                        <p className={cn("text-2xl font-bold tracking-tight", stats.successRate === 100 ? "text-green-500" : stats.successRate >= 80 ? "text-yellow-500" : "text-destructive")}>
                            {stats.successRate}<span className="text-sm font-normal text-muted-foreground ml-1">%</span>
                        </p>
                    </CardContent>
                 </Card>
                 <Card>
                    <CardContent className="p-4">
                        <p className="text-xs text-muted-foreground mb-1">Min / Max</p>
                        <div className="flex items-center gap-2">
                             <span className="text-lg font-semibold text-green-600 dark:text-green-400">{stats.minRtt}</span>
                             <span className="text-muted-foreground">/</span>
                             <span className="text-lg font-semibold text-orange-600 dark:text-orange-400">{stats.maxRtt}</span>
                             <span className="text-xs text-muted-foreground">ms</span>
                        </div>
                    </CardContent>
                 </Card>
                 <Card>
                    <CardContent className="p-4">
                         <p className="text-xs text-muted-foreground mb-1">Total Pings</p>
                         <p className="text-2xl font-bold tracking-tight">{isContinuous ? aggregatedDataRef.current.reduce((acc, curr) => acc + curr.totalPings, 0) : history.length}</p>
                    </CardContent>
                 </Card>
             </div>

             {/* Recent History List */}
             {!isContinuous && history.length > 0 && (
                 <Card className="h-75 flex flex-col">
                    <CardHeader className="py-3 px-4 border-b">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                             <History className="h-4 w-4" /> Recent Pings
                        </CardTitle>
                    </CardHeader>
                    <div className="flex-1 overflow-auto">
                        <Table>
                            <TableHeader className="sticky top-0 bg-card z-10">
                                <TableRow>
                                    <TableHead className="h-8 text-xs">Time</TableHead>
                                    <TableHead className="h-8 text-xs">Status</TableHead>
                                    <TableHead className="h-8 text-xs text-right">RTT</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {history.map((entry) => (
                                    <TableRow key={entry.id} className="cursor-default hover:bg-muted/50">
                                        <TableCell className="py-2 text-xs font-mono text-muted-foreground">
                                            {formatTime(entry.timestamp)}
                                        </TableCell>
                                        <TableCell className="py-2">
                                            <StatusBadge
                                                status={entry.isSuccess ? "success" : "error"}
                                                label={entry.isSuccess ? "Success" : "Failed"}
                                                className="scale-75 origin-left"
                                            />
                                        </TableCell>
                                        <TableCell className={cn("py-2 text-xs font-mono text-right", getRttColor(entry.roundtripTime))}>
                                            {entry.isSuccess ? `${entry.roundtripTime}ms` : "-"}
                                        </TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    </div>
                 </Card>
             )}
        </div>
      </div>
    </motion.div>
  );
}

