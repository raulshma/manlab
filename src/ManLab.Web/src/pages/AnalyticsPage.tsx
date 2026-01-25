import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Brush,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { format } from "date-fns";
import {
  Activity,
  BarChart3,
  Cpu,
  HardDrive,
  LayoutDashboard,
  MemoryStick,
  Network,
  SlidersHorizontal,
  Server,
  Zap,
  Clock,
} from "lucide-react";

import type { Node, Telemetry, TelemetryHistoryPoint } from "@/types";
import {
  fetchNodeTelemetry,
  fetchNodeTelemetryHistory,
  fetchNodes,
} from "@/api";
import { mapWithConcurrency } from "@/lib/async";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

import { cn } from "@/lib/utils";

import { NodeHealthTab } from "@/components/node-detail/NodeHealthTab";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

function percent(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function formatShortTime(ts: string): string {
  try {
    return format(new Date(ts), "HH:mm");
  } catch {
    return ts;
  }
}

type TelemetryMetric =
  | "cpu"
  | "ram"
  | "disk"
  | "temperature"
  | "netRx"
  | "netTx"
  | "pingRtt"
  | "pingLoss";

type TelemetryStat = "avg" | "p95" | "max";

type FleetLatestTelemetry = Record<string, Telemetry | null>;

const TIME_RANGES = {
  "1h": { label: "1 Hour", ms: 60 * 60 * 1000 },
  "3h": { label: "3 Hours", ms: 3 * 60 * 60 * 1000 },
  "6h": { label: "6 Hours", ms: 6 * 60 * 60 * 1000 },
  "12h": { label: "12 Hours", ms: 12 * 60 * 60 * 1000 },
  "24h": { label: "24 Hours", ms: 24 * 60 * 60 * 1000 },
  "7d": { label: "7 Days", ms: 7 * 24 * 60 * 60 * 1000 },
  "30d": { label: "30 Days", ms: 30 * 24 * 60 * 60 * 1000 },
  "90d": { label: "90 Days", ms: 90 * 24 * 60 * 60 * 1000 },
  "365d": { label: "1 Year", ms: 365 * 24 * 60 * 60 * 1000 },
} as const;

type TimeRangeKey = keyof typeof TIME_RANGES;

type TelemetryComparePoint = TelemetryHistoryPoint;

function getMetricValue(point: TelemetryComparePoint, metric: TelemetryMetric, stat: TelemetryStat): number | null {
  const key =
    metric === "cpu" ? `cpu${stat === "avg" ? "Avg" : stat === "p95" ? "P95" : "Max"}` :
    metric === "ram" ? `ram${stat === "avg" ? "Avg" : stat === "p95" ? "P95" : "Max"}` :
    metric === "disk" ? `disk${stat === "avg" ? "Avg" : stat === "p95" ? "P95" : "Max"}` :
    metric === "temperature" ? `temp${stat === "avg" ? "Avg" : stat === "p95" ? "P95" : "Max"}` :
    metric === "netRx" ? `netRx${stat === "avg" ? "Avg" : stat === "p95" ? "P95" : "Max"}` :
    metric === "netTx" ? `netTx${stat === "avg" ? "Avg" : stat === "p95" ? "P95" : "Max"}` :
    metric === "pingRtt" ? `pingRtt${stat === "avg" ? "Avg" : stat === "p95" ? "P95" : "Max"}` :
    `pingLoss${stat === "avg" ? "Avg" : stat === "p95" ? "P95" : "Max"}`;

  const raw = (point as unknown as Record<string, unknown>)[key];
  return typeof raw === "number" ? raw : null;
}

function formatBytesPerSec(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(2)} MB/s`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KB/s`;
  return `${value.toFixed(0)} B/s`;
}

function percentile(values: number[], p: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1));
  return sorted[idx] ?? null;
}

async function fetchFleetLatestTelemetry(nodes: Node[]): Promise<FleetLatestTelemetry> {
  const ids = nodes.map((n) => n.id);

  const rows = await mapWithConcurrency(
    ids,
    async (nodeId) => {
      try {
        const items = await fetchNodeTelemetry(nodeId, 1);
        return [nodeId, items[0] ?? null] as const;
      } catch {
        // Node exists but has no telemetry yet (or temporarily unavailable)
        return [nodeId, null] as const;
      }
    },
    { concurrency: 6 }
  );

  return Object.fromEntries(rows);
}

function StatCard({
  title,
  value,
  icon: Icon,
  hint,
  trend,
  trendLabel,
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
}) {
  return (
    <Card className="relative overflow-hidden border border-border shadow-sm bg-card transition-all hover:shadow-md hover:scale-[1.01] group">
      <div className="absolute top-0 right-0 -mt-4 -mr-4 h-24 w-24 rounded-full bg-primary/5 group-hover:bg-primary/10 transition-colors" />
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
        <div className="p-2 rounded-full bg-primary/10 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline space-x-2">
          <div className="text-3xl font-extrabold tracking-tight">{value}</div>
          {trend && (
             <span className={cn(
                "text-xs font-medium px-1.5 py-0.5 rounded-full",
                trend === "up" ? "bg-emerald-500/10 text-emerald-500" :
                trend === "down" ? "bg-rose-500/10 text-rose-500" : "bg-zinc-500/10 text-zinc-500"
             )}>
                {trendLabel}
             </span>
          )}
        </div>
        {hint && <p className="text-xs text-muted-foreground mt-2">{hint}</p>}
      </CardContent>
    </Card>
  );
}

function NodeMultiSelect({
  nodes,
  selectedIds,
  onChange,
  maxSelected = 5,
}: {
  nodes: Node[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
  maxSelected?: number;
}) {
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
  const [open, setOpen] = useState(false);

  const selectedNodes = useMemo(
    () => nodes.filter((n) => selectedSet.has(n.id)),
    [nodes, selectedSet]
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {selectedNodes.length === 0 ? (
          <div className="flex h-9 items-center px-3 rounded-md border border-dashed text-sm text-muted-foreground bg-muted/30">
             Select nodes to compare (max {maxSelected})
          </div>
        ) : (
          selectedNodes.map((n) => (
            <Badge key={n.id} variant="secondary" className="pl-2 pr-1 py-1 text-sm font-normal gap-1 transition-all hover:bg-secondary/80">
              {n.hostname}
              <Button
                variant="ghost"
                size="icon"
                className="h-4 w-4 ml-1 rounded-full hover:bg-background/20"
                onClick={() => onChange(selectedIds.filter(id => id !== n.id))}
              >
                <span className="sr-only">Remove</span>
                &times;
              </Button>
            </Badge>
          ))
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(
            buttonVariants({ variant: "outline", size: "default" }),
            "border-dashed"
          )}
        >
          <Network className="h-4 w-4 mr-2 text-primary" />
          Add Node
        </PopoverTrigger>
        <PopoverContent className="p-0 w-60" align="start">
          <Command>
            <CommandInput placeholder="Search nodes…" />
            <CommandList>
              <CommandEmpty>No nodes found.</CommandEmpty>
              <CommandGroup heading="Available Nodes">
                <ScrollArea className="h-64">
                  {nodes.map((n) => {
                    const checked = selectedSet.has(n.id);
                    const disabled = !checked && selectedIds.length >= maxSelected;

                    return (
                      <CommandItem
                        key={n.id}
                        value={n.hostname}
                        onSelect={() => {
                          if (disabled) return;
                          const next = checked
                            ? selectedIds.filter((id) => id !== n.id)
                            : [...selectedIds, n.id];
                          onChange(next);
                        }}
                        disabled={disabled}
                      >
                         <div className={cn(
                            "mr-2 flex h-4 w-4 items-center justify-center rounded-sm border border-primary",
                            checked ? "bg-primary text-primary-foreground" : "opacity-50 [&_svg]:invisible"
                         )}>
                            <svg
                               className={cn("h-4 w-4")}
                               fill="none"
                               viewBox="0 0 24 24"
                               stroke="currentColor"
                               strokeWidth={2}
                            >
                               <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                         </div>
                        <span className="truncate flex-1">{n.hostname}</span>
                        <span className={cn(
                            "ml-2 text-[10px] px-1.5 py-0.5 rounded-full font-mono",
                             n.status === "Online" ? "bg-emerald-500/10 text-emerald-500" :
                             n.status === "Offline" ? "bg-rose-500/10 text-rose-500" : "bg-yellow-500/10 text-yellow-500"
                        )}>
                          {n.status}
                        </span>
                      </CommandItem>
                    );
                  })}
                </ScrollArea>
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function mergeTelemetrySeries(
  seriesByNode: Record<string, TelemetryComparePoint[]>,
  metric: TelemetryMetric,
  stat: TelemetryStat
): Array<Record<string, number | string | null>> {
  // Build a union timeline.
  interface MergedTelemetryRow extends Record<string, number | string | null> {
    timestamp: string;
  }

  const map = new Map<string, MergedTelemetryRow>();

  for (const [nodeId, series] of Object.entries(seriesByNode)) {
    for (const point of series) {
      const ts = point.timestamp;
      const row: MergedTelemetryRow = map.get(ts) ?? { timestamp: ts };
      row[nodeId] = getMetricValue(point, metric, stat);
      map.set(ts, row);
    }
  }

  return [...map.values()].sort((a, b) => {
    const ta = typeof a.timestamp === "string" ? Date.parse(a.timestamp) : 0;
    const tb = typeof b.timestamp === "string" ? Date.parse(b.timestamp) : 0;
    return ta - tb;
  });
}

export function AnalyticsPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<"fleet" | "node" | "compare">("fleet");
  const [selectedNodeId, setSelectedNodeId] = useState<string>("");
  const [compareNodeIds, setCompareNodeIds] = useState<string[]>([]);
  const [compareMetric, setCompareMetric] = useState<TelemetryMetric>("cpu");
  const [compareStat, setCompareStat] = useState<TelemetryStat>("avg");
  const [compareResolution, setCompareResolution] = useState<"auto" | "raw" | "hour" | "day">("auto");
  const [brushRange, setBrushRange] = useState<{ startIndex?: number; endIndex?: number } | null>(null);
  
  const [timeRange, setTimeRange] = useState<TimeRangeKey>(() => {
    const stored = localStorage.getItem("analytics-time-range") as TimeRangeKey | null;
    return stored && TIME_RANGES[stored] ? stored : "1h";
  });

  const handleTimeRangeChange = (v: TimeRangeKey) => {
    setTimeRange(v);
    localStorage.setItem("analytics-time-range", v);
    setBrushRange(null);
  };

  const handleCompareNodesChange = (next: string[]) => {
    setCompareNodeIds(next);
    setBrushRange(null);
  };

  const { data: nodes, isLoading: nodesLoading, isError: nodesError } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const effectiveNodes = useMemo(() => nodes ?? [], [nodes]);

  // Default selected node (for the per-node analytics tab).
  const effectiveSelectedNodeId = useMemo(() => {
    if (!effectiveNodes.length) return "";
    if (selectedNodeId && effectiveNodes.some((n) => n.id === selectedNodeId)) return selectedNodeId;
    return effectiveNodes[0].id;
  }, [effectiveNodes, selectedNodeId]);

  const selectedNode = useMemo(
    () => effectiveNodes.find((n) => n.id === effectiveSelectedNodeId) ?? null,
    [effectiveNodes, effectiveSelectedNodeId]
  );

  const { data: latestTelemetry, isLoading: fleetTelemetryLoading } = useQuery({
    queryKey: ["fleetLatestTelemetry", effectiveNodes.map((n) => n.id)],
    queryFn: () => fetchFleetLatestTelemetry(effectiveNodes),
    enabled: effectiveNodes.length > 0,
    staleTime: 5_000,
    refetchInterval: 30_000,
  });

  const fleetStats = useMemo(() => {
    const total = effectiveNodes.length;
    const online = effectiveNodes.filter((n) => n.status === "Online").length;
    const offline = effectiveNodes.filter((n) => n.status === "Offline").length;
    const error = effectiveNodes.filter((n) => n.status === "Error").length;

    const rows = effectiveNodes
      .map((n) => ({ node: n, telemetry: latestTelemetry?.[n.id] ?? null }))
      .filter((x) => x.telemetry !== null);

    const avg = (metric: "cpuUsage" | "ramUsage" | "diskUsage"): number | null => {
      if (!rows.length) return null;
      const values = rows
        .map((r) => r.telemetry?.[metric])
        .filter((v): v is number => typeof v === "number");
      if (!values.length) return null;
      return values.reduce((a, b) => a + b, 0) / values.length;
    };

    const hotCpu = rows.filter((r) => (r.telemetry?.cpuUsage ?? 0) >= 80).length;

    return {
      total,
      online,
      offline,
      error,
      avgCpu: avg("cpuUsage"),
      avgRam: avg("ramUsage"),
      avgDisk: avg("diskUsage"),
      hotCpu,
      rows,
    };
  }, [effectiveNodes, latestTelemetry]);

  const topCpuNodes = useMemo(() => {
    return [...fleetStats.rows]
      .sort((a, b) => (b.telemetry?.cpuUsage ?? 0) - (a.telemetry?.cpuUsage ?? 0))
      .slice(0, 10)
      .map((x) => ({
        nodeId: x.node.id,
        hostname: x.node.hostname,
        status: x.node.status,
        cpu: x.telemetry?.cpuUsage ?? 0,
        ram: x.telemetry?.ramUsage ?? 0,
        disk: x.telemetry?.diskUsage ?? 0,
        temp: x.telemetry?.temperature ?? null,
        lastSeen: x.node.lastSeen,
      }));
  }, [fleetStats.rows]);

  const statusPie = useMemo(() => {
    const items = [
      { name: "Online", value: fleetStats.online, color: "var(--chart-2)" },
      { name: "Offline", value: fleetStats.offline, color: "var(--chart-5)" },
      { name: "Error", value: fleetStats.error, color: "var(--destructive)" },
      {
        name: "Other",
        value: Math.max(0, fleetStats.total - fleetStats.online - fleetStats.offline - fleetStats.error),
        color: "var(--muted-foreground)",
      },
    ].filter((x) => x.value > 0);

    return items;
  }, [fleetStats]);

  const compareRange = useMemo(() => {
    const end = new Date();
    const start = new Date(end.getTime() - TIME_RANGES[timeRange].ms);
    return {
      start,
      end,
      fromUtc: start.toISOString(),
      toUtc: end.toISOString(),
    };
  }, [timeRange]);

  const compareTelemetryQueries = useQuery({
    queryKey: ["compareTelemetry", compareNodeIds, compareMetric, compareStat, timeRange, compareResolution],
    enabled: compareNodeIds.length > 0,
    queryFn: async () => {
      const series = await mapWithConcurrency(
        compareNodeIds,
        async (nodeId) => {
          const history = await fetchNodeTelemetryHistory(nodeId, {
            fromUtc: compareRange.fromUtc,
            toUtc: compareRange.toUtc,
            resolution: compareResolution,
          });
          return {
            nodeId,
            points: history.points,
            granularity: history.granularity,
            bucketSeconds: history.bucketSeconds,
          } as const;
        },
        { concurrency: 4 }
      );

      const byNode = Object.fromEntries(
        series.map((item) => [item.nodeId, item.points])
      ) as Record<string, TelemetryComparePoint[]>;
      const merged = mergeTelemetrySeries(byNode, compareMetric, compareStat);
      const meta = series[0];
      return {
        byNode,
        merged,
        granularity: meta?.granularity ?? compareResolution,
        bucketSeconds: meta?.bucketSeconds ?? 0,
      };
    },
    staleTime: 5_000,
    refetchInterval: 20_000,
  });

  const compareChartConfig: ChartConfig = useMemo(() => {
    const palette = [
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
    ];

    const cfg: ChartConfig = {
      timestamp: { label: "Time" },
    };

    compareNodeIds.slice(0, 5).forEach((nodeId, idx) => {
      const node = effectiveNodes.find((n) => n.id === nodeId);
      cfg[nodeId] = {
        label: node?.hostname ?? nodeId,
        color: palette[idx % palette.length],
      };
    });

    return cfg;
  }, [compareNodeIds, effectiveNodes]);

  const compareMetricLabel = 
    compareMetric === "cpu" ? "CPU" : 
    compareMetric === "ram" ? "RAM" : 
    compareMetric === "disk" ? "Disk" :
    compareMetric === "temperature" ? "Temperature" :
    compareMetric === "netRx" ? "Network Download" :
    compareMetric === "netTx" ? "Network Upload" :
    compareMetric === "pingRtt" ? "Ping Latency" : "Ping Packet Loss";

  const compareRangeLabel = useMemo(() => {
    return `${format(compareRange.start, "PPp")} → ${format(compareRange.end, "PPp")}`;
  }, [compareRange]);

  const axisTimeFormat = useMemo(() => {
    const spanMs = compareRange.end.getTime() - compareRange.start.getTime();
    return spanMs > 36 * 60 * 60 * 1000 ? "MMM d" : "HH:mm";
  }, [compareRange]);

  const formatCompareValue = (value: number | null | undefined): string => {
    if (value === null || value === undefined || Number.isNaN(value)) return "—";
    if (["cpu", "ram", "disk", "pingLoss"].includes(compareMetric)) return percent(value);
    if (compareMetric === "temperature") return `${value.toFixed(1)}°C`;
    if (compareMetric === "pingRtt") return `${value.toFixed(0)} ms`;
    if (compareMetric === "netRx" || compareMetric === "netTx") return formatBytesPerSec(value);
    return value.toFixed(2);
  };

  const compareInsights = useMemo(() => {
    const byNode = compareTelemetryQueries.data?.byNode ?? {};
    return compareNodeIds.map((nodeId) => {
      const series = byNode[nodeId] ?? [];
      const values = series
        .map((point) => getMetricValue(point, compareMetric, compareStat))
        .filter((v): v is number => typeof v === "number" && !Number.isNaN(v));

      const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      const p95 = values.length ? percentile(values, 0.95) : null;
      const min = values.length ? Math.min(...values) : null;
      const max = values.length ? Math.max(...values) : null;
      const trend = values.length > 1 ? values[values.length - 1] - values[0] : null;

      return {
        nodeId,
        hostname: effectiveNodes.find((n) => n.id === nodeId)?.hostname ?? nodeId,
        avg,
        p95,
        min,
        max,
        trend,
      };
    });
  }, [compareTelemetryQueries.data, compareNodeIds, compareMetric, compareStat, effectiveNodes]);

  const exportTelemetry = (type: "csv" | "json") => {
    const merged = compareTelemetryQueries.data?.merged ?? [];
    if (!merged.length) return;

    const nodeLabels = compareNodeIds.map((id) => compareChartConfig[id]?.label ?? id);
    const filename = `telemetry-${compareMetric}-${compareStat}-${timeRange}.${type}`;

    if (type === "json") {
      const payload = {
        metric: compareMetric,
        statistic: compareStat,
        range: compareRange,
        resolution: compareTelemetryQueries.data?.granularity ?? compareResolution,
        nodes: compareNodeIds.map((id, idx) => ({ id, label: nodeLabels[idx] })),
        data: merged,
      };
      const json = JSON.stringify(payload, null, 2);
      downloadBlob(json, filename, "application/json");
      return;
    }

    const header = ["timestamp", ...nodeLabels];
    const rows = merged.map((row) => {
      const values = compareNodeIds.map((id) => {
        const raw = row[id];
        return typeof raw === "number" ? raw.toString() : "";
      });
      return [row.timestamp, ...values].join(",");
    });
    const csv = [header.join(","), ...rows].join("\n");
    downloadBlob(csv, filename, "text/csv");
  };

  const downloadBlob = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const fleetBarConfig: ChartConfig = {
    cpu: { label: "CPU", color: "var(--chart-1)" },
    ram: { label: "RAM", color: "var(--chart-2)" },
    disk: { label: "Disk", color: "var(--chart-3)" },
  };

  const statusPieConfig: ChartConfig = {
    Online: { label: "Online", color: "var(--chart-2)" },
    Offline: { label: "Offline", color: "var(--chart-5)" },
    Error: { label: "Error", color: "var(--destructive)" },
    Other: { label: "Other", color: "var(--muted-foreground)" },
  };

  const isValidTab = (v: string): v is "fleet" | "node" | "compare" =>
    v === "fleet" || v === "node" || v === "compare";

  const isValidMetric = (v: string): v is TelemetryMetric =>
    [
      "cpu", "ram", "disk", "temperature",
      "netRx", "netTx",
      "pingRtt", "pingLoss"
    ].includes(v);

  const isStatusPayload = (x: unknown): x is { name: string; value: number } => {
    if (!x || typeof x !== "object") return false;
    const obj = x as Record<string, unknown>;
    return typeof obj.name === "string" && typeof obj.value === "number";
  };

  return (
    <div className="min-h-screen bg-background/50">
      <div className="mx-auto max-w-7xl space-y-8 p-4 md:p-6 lg:p-10">
        
        {/* Header Section */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-primary to-primary/60">
              Analytics
            </h1>
            <p className="text-muted-foreground text-lg font-light max-w-2xl">
              Real-time telemetry, fleet health monitoring, and comparative performance metrics.
            </p>
          </div>
          <div className="flex items-center gap-3">
             <Button variant="outline" size="sm" onClick={() => navigate("/nodes")} className="h-9">
              <Server className="h-4 w-4 mr-2 text-muted-foreground" />
              Manage Nodes
            </Button>
            <Button size="sm" className="h-9 shadow-lg shadow-primary/20">
              <Zap className="h-4 w-4 mr-2" />
               Generate Report
            </Button>
          </div>
        </header>

        <Separator className="bg-border/40" />

        <Tabs 
          value={activeTab} 
          onValueChange={(v) => setActiveTab(isValidTab(v) ? v : "fleet")}
          className="space-y-8"
        >
          <div className="flex items-center justify-between">
             <TabsList className="h-auto flex-wrap gap-2 items-stretch p-1 bg-muted/60 backdrop-blur-sm">
                <TabsTrigger value="fleet" className="px-6 text-sm">
                   <LayoutDashboard className="h-4 w-4 mr-2 opacity-70" />
                   Fleet Overview
                </TabsTrigger>
                <TabsTrigger value="node" className="px-6 text-sm">
                   <Activity className="h-4 w-4 mr-2 opacity-70" />
                   Per-Node Analysis
                </TabsTrigger>
                <TabsTrigger value="compare" className="px-6 text-sm">
                   <BarChart3 className="h-4 w-4 mr-2 opacity-70" />
                   Telemetry History
                </TabsTrigger>
             </TabsList>
             
             {/* Dynamic sub-header interactions based on tab could go here */}
          </div>

          <TabsContent value="fleet" className="space-y-8 animate-in fade-in-50 slide-in-from-bottom-2 duration-500">
            {/* Quick Stats Row */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
              <StatCard 
                 title="Total Nodes" 
                 value={`${fleetStats.total}`} 
                 icon={Server} 
                 hint={nodesLoading ? "Syncing fleet..." : "Total managed nodes"}
                 trend="neutral"
              />
              <StatCard 
                 title="Online Nodes" 
                 value={`${fleetStats.online}`} 
                 icon={Activity} 
                 hint={fleetStats.total ? `${Math.round((fleetStats.online / fleetStats.total) * 100)}% uptime` : ""}
                 trend={fleetStats.online === fleetStats.total ? "up" : "down"}
                 trendLabel={fleetStats.online === fleetStats.total ? "100%" : "Check offline"}
              />
              <StatCard 
                 title="Avg Fleet CPU" 
                 value={percent(fleetStats.avgCpu)} 
                 icon={Cpu} 
                 hint={fleetTelemetryLoading ? "Live updating..." : "Real-time average"}
                 trend={fleetStats.avgCpu && fleetStats.avgCpu > 80 ? "down" : "up"}
                 trendLabel={fleetStats.avgCpu ? (fleetStats.avgCpu > 80 ? "Heavy Load" : "Healthy") : undefined}
              />
              <StatCard 
                 title="High Load Nodes" 
                 value={`${fleetStats.hotCpu}`} 
                 icon={Zap} 
                 hint="Nodes with CPU ≥ 80%"
                 trend={fleetStats.hotCpu > 0 ? "down" : "up"}
                 trendLabel={fleetStats.hotCpu === 0 ? "All Good" : "Attention Needed"}
              />
            </div>

            {/* Main Charts Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Top Nodes Chart */}
              <Card className="lg:col-span-2 shadow-sm border border-border bg-card">
                <CardHeader>
                  <CardTitle>Resource Leaders</CardTitle>
                  <CardDescription>Nodes with the highest current CPU utilization.</CardDescription>
                </CardHeader>
                <CardContent>
                  <ChartContainer id="fleet-top" config={fleetBarConfig} className="h-87.5 w-full">
                    <BarChart data={topCpuNodes} margin={{ left: 0, right: 0, top: 10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="fillCpu" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="var(--color-cpu)" stopOpacity={0.8}/>
                          <stop offset="95%" stopColor="var(--color-cpu)" stopOpacity={0.1}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.1} />
                      <XAxis
                        dataKey="hostname"
                        tickLine={false}
                        axisLine={false}
                        interval={0}
                        tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                        height={60}
                        angle={-30}
                        textAnchor="end"
                      />
                      <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} domain={[0, 100]} />
                      <ChartTooltip
                        cursor={{ fill: "var(--muted)/20" }}
                        content={
                          <ChartTooltipContent
                            labelKey="hostname"
                            formatter={(value, name) => [percent(Number(value)), name]}
                          />
                        }
                      />
                      <Bar dataKey="cpu" fill="url(#fillCpu)" radius={[4, 4, 0, 0]} maxBarSize={50} />
                    </BarChart>
                  </ChartContainer>
                </CardContent>
              </Card>

              {/* Status Distribution */}
              <Card className="shadow-sm border border-border bg-card">
                <CardHeader>
                  <CardTitle>Fleet Health</CardTitle>
                  <CardDescription>Distribution of node statuses.</CardDescription>
                </CardHeader>
                <CardContent className="flex items-center justify-center">
                  <ChartContainer id="fleet-status" config={statusPieConfig} className="h-87.5 w-full max-w-75">
                    <PieChart>
                      <RechartsTooltip
                         cursor={false}
                         content={({ active, payload }) => {
                          if (!active || !payload?.length) return null;
                          const raw = payload[0].payload as unknown;
                          if (!isStatusPayload(raw)) return null;

                          return (
                            <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md animate-in fade-in-0 zoom-in-95">
                              <h5 className="font-medium text-popover-foreground mb-1">{raw.name}</h5>
                              <div className="text-muted-foreground">{raw.value} nodes</div>
                            </div>
                          );
                        }}
                      />
                      <Pie 
                         data={statusPie} 
                         dataKey="value" 
                         nameKey="name" 
                         innerRadius={80} 
                         outerRadius={110} 
                         paddingAngle={4}
                         stroke="none"
                      >
                        {statusPie.map((entry) => (
                          <Cell key={entry.name} fill={entry.color} className="stroke-background hover:opacity-80 transition-opacity" strokeWidth={3} />
                        ))}
                      </Pie>
                      <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="fill-foreground text-2xl font-bold">
                         {fleetStats.total}
                      </text>
                      <text x="50%" y="55%" textAnchor="middle" dominantBaseline="middle" className="fill-muted-foreground text-xs font-medium translate-y-4">
                         Total Nodes
                      </text>
                    </PieChart>
                  </ChartContainer>
                </CardContent>
              </Card>
            </div>

            {/* Fleet Table */}
            <Card className="border shadow-sm overflow-hidden">
               <CardHeader className="bg-muted/30 border-b">
                 <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Node Performance Matrix</CardTitle>
                        <CardDescription>Comprehensive real-time metrics for all managed nodes.</CardDescription>
                    </div>
                 </div>
               </CardHeader>
              <CardContent className="p-0">
                {nodesError ? (
                  <div className="p-8 text-center text-destructive">Failed to load nodes data.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader className="bg-muted/10">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-50">Node Name</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">CPU</TableHead>
                          <TableHead className="text-right">RAM</TableHead>
                          <TableHead className="text-right">Disk</TableHead>
                          <TableHead className="text-right">Temperature</TableHead>
                          <TableHead className="text-right">Last Seen</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {topCpuNodes.map((r) => (
                          <TableRow key={r.nodeId} className="hover:bg-muted/30 transition-colors">
                            <TableCell className="font-medium">
                              <Link 
                                 to={`/nodes/${r.nodeId}`}
                                 className="flex items-center gap-2 hover:text-primary transition-colors group"
                              >
                                 <Server className="h-4 w-4 text-muted-foreground group-hover:text-primary transition-colors" />
                                 {r.hostname}
                              </Link>
                            </TableCell>
                            <TableCell>
                               <div className="flex items-center gap-2">
                                  <div className={cn("h-2 w-2 rounded-full", r.status === "Online" ? "bg-emerald-500" : r.status === "Offline" ? "bg-destructive" : "bg-yellow-500")} />
                                  <span className="text-muted-foreground">{r.status}</span>
                               </div>
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-foreground/80">
                               <span className={cn(r.cpu > 80 ? "text-destructive font-bold" : "")}>{percent(r.cpu)}</span>
                            </TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-foreground/80">{percent(r.ram)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-foreground/80">{percent(r.disk)}</TableCell>
                            <TableCell className="text-right font-mono tabular-nums text-foreground/80">
                              {r.temp === null ? "—" : `${r.temp.toFixed(1)}°C`}
                            </TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground font-mono">
                              {formatShortTime(r.lastSeen)}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                )}
              </CardContent>
            </Card>

            <div className="flex items-center gap-2 p-4 rounded-lg bg-blue-500/5 border border-blue-500/10 text-sm text-blue-500">
               <Zap className="h-4 w-4" />
               <span className="font-medium">Pro Tip:</span>
               Fleet analytics uses real-time snapshots. For historical trends, switch to the "Per Node" tab.
            </div>
          </TabsContent>

          <TabsContent value="node" className="space-y-6 animate-in fade-in-50 slide-in-from-bottom-2 duration-500">
            <Card className="border-none shadow-none bg-transparent">
              <CardContent className="p-0">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between bg-card p-6 rounded-xl border shadow-sm">
                  <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center w-full">
                     <div className="p-3 bg-primary/10 rounded-full">
                        <Server className="h-6 w-6 text-primary" />
                     </div>
                     <div className="space-y-1 flex-1">
                        <h3 className="font-semibold text-lg">Select Node</h3>
                        <p className="text-sm text-muted-foreground">Choose a node to view detailed health metrics.</p>
                     </div>
                    <Select
                      value={effectiveSelectedNodeId}
                      onValueChange={(v) => setSelectedNodeId(v ?? "")}
                      disabled={!effectiveNodes.length}
                    >
                      <SelectTrigger className="w-70 h-11">
                        <SelectValue>
                          {selectedNode
                            ? `${selectedNode.hostname} • ${selectedNode.status}`
                            : "Select a node…"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {effectiveNodes.map((n) => (
                          <SelectItem key={n.id} value={n.id}>
                            <div className="flex items-center gap-2">
                               <div className={cn("h-2 w-2 rounded-full", n.status === "Online" ? "bg-emerald-500" : "bg-zinc-300")} />
                               {n.hostname}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {effectiveSelectedNodeId ? (
                    <Button
                      variant="default"
                      className="w-full sm:w-auto mt-4 sm:mt-0"
                      onClick={() => navigate(`/nodes/${effectiveSelectedNodeId}`)}
                    >
                      <Activity className="h-4 w-4 mr-2" />
                      Full Details
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {effectiveSelectedNodeId ? (
              <div className="transition-all duration-300">
                 <NodeHealthTab nodeId={effectiveSelectedNodeId} />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed rounded-xl text-center">
                 <Server className="h-12 w-12 text-muted-foreground/30 mb-4" />
                 <h3 className="text-lg font-medium text-foreground">No Nodes Available</h3>
                 <p className="text-muted-foreground max-w-sm">Connect a node to the cluster to begin monitoring performance.</p>
              </div>
            )}
          </TabsContent>

          <TabsContent value="compare" className="space-y-6 animate-in fade-in-50 slide-in-from-bottom-2 duration-500">
             <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
                {/* Comparison Controls */}
                <Card className="lg:col-span-1 h-fit">
                   <CardHeader>
                      <CardTitle className="text-base">Compare Configuration</CardTitle>
                      <CardDescription>Select metric and nodes.</CardDescription>
                   </CardHeader>
                   <CardContent className="space-y-6">
                      <div className="space-y-2">
                         <label className="text-sm font-medium">Metric</label>
                         <Select
                           value={compareMetric}
                          onValueChange={(v) => {
                            setCompareMetric(isValidMetric(v ?? "") ? (v as TelemetryMetric) : "cpu");
                            setBrushRange(null);
                          }}
                         >
                           <SelectTrigger className="h-10">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                            <SelectItem value="cpu">
                                 <div className="flex items-center gap-2"><Cpu className="h-4 w-4 text-muted-foreground" /> CPU Usage</div>
                              </SelectItem>
                            <SelectItem value="ram">
                                 <div className="flex items-center gap-2"><MemoryStick className="h-4 w-4 text-muted-foreground" /> RAM Usage</div>
                              </SelectItem>
                            <SelectItem value="disk">
                                 <div className="flex items-center gap-2"><HardDrive className="h-4 w-4 text-muted-foreground" /> Disk Usage</div>
                              </SelectItem>
                              <SelectItem value="temperature">
                                 <div className="flex items-center gap-2"><Zap className="h-4 w-4 text-muted-foreground" /> Temperature</div>
                              </SelectItem>
                            <SelectItem value="netRx">
                                 <div className="flex items-center gap-2"><Network className="h-4 w-4 text-muted-foreground" /> Network Download</div>
                              </SelectItem>
                            <SelectItem value="netTx">
                                 <div className="flex items-center gap-2"><Network className="h-4 w-4 text-muted-foreground" /> Network Upload</div>
                              </SelectItem>
                            <SelectItem value="pingRtt">
                                 <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-muted-foreground" /> Ping Latency</div>
                              </SelectItem>
                            <SelectItem value="pingLoss">
                              <div className="flex items-center gap-2"><Activity className="h-4 w-4 text-muted-foreground" /> Ping Packet Loss</div>
                            </SelectItem>
                           </SelectContent>
                         </Select>
                      </div>

                       <div className="space-y-2">
                         <label className="text-sm font-medium">Statistic</label>
                         <Select value={compareStat} onValueChange={(v) => {
                            setCompareStat(v as TelemetryStat);
                            setBrushRange(null);
                          }}>
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="avg">
                              <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> Average</div>
                            </SelectItem>
                            <SelectItem value="p95">
                              <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> P95</div>
                            </SelectItem>
                            <SelectItem value="max">
                              <div className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-muted-foreground" /> Max</div>
                            </SelectItem>
                          </SelectContent>
                         </Select>
                       </div>

                       <div className="space-y-2">
                         <label className="text-sm font-medium">Resolution</label>
                         <Select value={compareResolution} onValueChange={(v) => {
                            setCompareResolution(v as "auto" | "raw" | "hour" | "day");
                            setBrushRange(null);
                          }}>
                          <SelectTrigger className="h-10">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="auto">Auto (Smart)</SelectItem>
                            <SelectItem value="raw">Raw (High Fidelity)</SelectItem>
                            <SelectItem value="hour">Hourly</SelectItem>
                            <SelectItem value="day">Daily</SelectItem>
                          </SelectContent>
                         </Select>
                       </div>

                      <div className="space-y-2">
                         <label className="text-sm font-medium">Time Range</label>
                         <Select
                           value={timeRange}
                           onValueChange={(v) => handleTimeRangeChange(v as TimeRangeKey)}
                         >
                           <SelectTrigger className="h-10">
                              <SelectValue />
                           </SelectTrigger>
                           <SelectContent>
                              {Object.entries(TIME_RANGES).map(([key, cfg]) => (
                                <SelectItem key={key} value={key}>
                                   <div className="flex items-center gap-2"><Clock className="h-4 w-4 text-muted-foreground" /> {cfg.label}</div>
                                </SelectItem>
                              ))}
                           </SelectContent>
                         </Select>
                      </div>

                      <div className="space-y-2">
                         <label className="text-sm font-medium">Nodes</label>
                         <NodeMultiSelect 
                           nodes={effectiveNodes} 
                           selectedIds={compareNodeIds} 
                           onChange={handleCompareNodesChange} 
                        />
                      </div>
                   </CardContent>
                </Card>

                {/* Main Comparison Chart */}
                <Card className="lg:col-span-3 min-h-125 flex flex-col">
                   <CardHeader>
                      <div className="flex items-center justify-between">
                         <div>
                            <CardTitle className="flex items-center gap-2">
                               {compareMetric === "cpu" ? <Cpu className="h-5 w-5 text-primary" /> : 
                                compareMetric === "ram" ? <MemoryStick className="h-5 w-5 text-primary" /> : 
                                compareMetric === "disk" ? <HardDrive className="h-5 w-5 text-primary" /> :
                                compareMetric === "temperature" ? <Zap className="h-5 w-5 text-primary" /> :
                                compareMetric === "pingRtt" || compareMetric === "pingLoss" ? <Activity className="h-5 w-5 text-primary" /> :
                                <Network className="h-5 w-5 text-primary" />}
                               {compareMetricLabel} Comparison
                            </CardTitle>
                            <CardDescription>
                              {compareRangeLabel} • {compareTelemetryQueries.data?.granularity ?? compareResolution} rollups
                            </CardDescription>
                         </div>
                         <div className="flex items-center gap-2">
                           <Badge variant="outline" className="font-mono text-xs">
                             {compareTelemetryQueries.data?.bucketSeconds
                               ? `${Math.round(compareTelemetryQueries.data.bucketSeconds / 60)}m buckets`
                               : "Raw samples"}
                           </Badge>
                           <Button variant="outline" size="sm" onClick={() => exportTelemetry("csv")}>
                             Export CSV
                           </Button>
                           <Button variant="outline" size="sm" onClick={() => exportTelemetry("json")}>
                             Export JSON
                           </Button>
                         </div>
                      </div>
                   </CardHeader>
                   <CardContent className="flex-1 min-h-75">
                     {compareNodeIds.length === 0 ? (
                       <div className="h-full flex flex-col items-center justify-center text-muted-foreground space-y-4 min-h-75">
                          <BarChart3 className="h-12 w-12 opacity-20" />
                          <p>Select nodes to compare performance metrics.</p>
                       </div>
                     ) : compareTelemetryQueries.isError ? (
                       <div className="h-full flex items-center justify-center text-destructive">Failed to load comparison data.</div>
                     ) : (compareTelemetryQueries.data?.merged?.length ?? 0) === 0 ? (
                       <div className="h-full flex items-center justify-center text-muted-foreground">No telemetry history found for the selected range.</div>
                     ) : (
                       <ChartContainer id="compare" config={compareChartConfig} className="h-full w-full min-h-100">
                         <AreaChart data={compareTelemetryQueries.data?.merged ?? []} margin={{ left: 0, right: 0, top: 20, bottom: 0 }}>
                           <defs>
                              {compareNodeIds.slice(0, 5).map((nodeId) => {
                                 // We need to match the palette logic from useMemo but locally here or just use CSS vars
                                 // Ideally we should move palette to a constant or use the chart config colors
                                 return (
                                    <linearGradient key={nodeId} id={`fill-${nodeId}`} x1="0" y1="0" x2="0" y2="1">
                                       <stop offset="5%" stopColor={`var(--color-${nodeId})`} stopOpacity={0.3}/>
                                       <stop offset="95%" stopColor={`var(--color-${nodeId})`} stopOpacity={0.0}/>
                                    </linearGradient>
                                 );
                              })}
                           </defs>
                           <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.1} />
                           <XAxis
                             dataKey="timestamp"
                             tickLine={false}
                             axisLine={false}
                             tickFormatter={(v) => {
                               if (typeof v !== "string") return String(v);
                               try {
                                 return format(new Date(v), axisTimeFormat);
                               } catch {
                                 return v;
                               }
                             }}
                             minTickGap={30}
                             tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                           />
                           <YAxis 
                              tickLine={false} 
                              axisLine={false} 
                              domain={[0, "auto"]} 
                              tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                              tickFormatter={(val) => formatCompareValue(Number(val))}
                           />
                           <ChartTooltip
                             content={
                               <ChartTooltipContent
                                 labelKey="timestamp"
                                  labelFormatter={(v) => { try { if (typeof v === "string") return format(new Date(v), "PPp"); return String(v); } catch { return String(v); } }}
                                 formatter={(value, name) => {
                                     const val = Number(value);
                                     return [formatCompareValue(val), name];
                                 }}
                               />
                             }
                           />
                           <ChartLegend content={<ChartLegendContent />} />

                           <Brush
                             dataKey="timestamp"
                             height={30}
                             stroke="var(--muted-foreground)"
                             startIndex={brushRange?.startIndex}
                             endIndex={brushRange?.endIndex}
                             onChange={(range) => setBrushRange(range)}
                             tickFormatter={(v) => {
                               if (typeof v !== "string") return String(v);
                               try {
                                 return format(new Date(v), axisTimeFormat);
                               } catch {
                                 return v;
                               }
                             }}
                           />

                           {compareNodeIds.slice(0, 5).map((nodeId) => (
                             <Area
                               key={nodeId}
                               type="monotone"
                               dataKey={nodeId}
                               stroke={`var(--color-${nodeId})`}
                               fill={`url(#fill-${nodeId})`}
                               strokeWidth={2}
                               dot={false}
                               connectNulls
                               activeDot={{ r: 4, strokeWidth: 0 }}
                             />
                           ))}
                         </AreaChart>
                       </ChartContainer>
                     )}
                   </CardContent>
                </Card>
             </div>

             <Card className="border shadow-sm">
               <CardHeader className="bg-muted/30 border-b">
                 <CardTitle className="text-base">Derived Insights</CardTitle>
                 <CardDescription>P95, trend, and range summaries for the selected metric.</CardDescription>
               </CardHeader>
               <CardContent className="p-0">
                 <div className="overflow-x-auto">
                   <Table>
                     <TableHeader className="bg-muted/10">
                       <TableRow className="hover:bg-transparent">
                         <TableHead>Node</TableHead>
                         <TableHead className="text-right">Avg</TableHead>
                         <TableHead className="text-right">P95</TableHead>
                         <TableHead className="text-right">Min</TableHead>
                         <TableHead className="text-right">Max</TableHead>
                         <TableHead className="text-right">Trend</TableHead>
                       </TableRow>
                     </TableHeader>
                     <TableBody>
                       {compareInsights.map((row) => (
                         <TableRow key={row.nodeId}>
                           <TableCell className="font-medium">{row.hostname}</TableCell>
                           <TableCell className="text-right font-mono tabular-nums">{formatCompareValue(row.avg)}</TableCell>
                           <TableCell className="text-right font-mono tabular-nums">{formatCompareValue(row.p95)}</TableCell>
                           <TableCell className="text-right font-mono tabular-nums">{formatCompareValue(row.min)}</TableCell>
                           <TableCell className="text-right font-mono tabular-nums">{formatCompareValue(row.max)}</TableCell>
                           <TableCell className="text-right font-mono tabular-nums">
                             {row.trend === null ? "—" : (
                               <span className={cn(
                                 "text-xs px-1.5 py-0.5 rounded-full",
                                 row.trend > 0 ? "bg-rose-500/10 text-rose-500" : row.trend < 0 ? "bg-emerald-500/10 text-emerald-500" : "bg-zinc-500/10 text-zinc-500"
                               )}>
                                 {row.trend > 0 ? "↑" : row.trend < 0 ? "↓" : "→"} {formatCompareValue(Math.abs(row.trend))}
                               </span>
                             )}
                           </TableCell>
                         </TableRow>
                       ))}
                     </TableBody>
                   </Table>
                 </div>
               </CardContent>
             </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
