import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  BarChart,
  Bar,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
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
  Network,
  Router,
  Thermometer,
} from "lucide-react";

import type { Node, Telemetry } from "@/types";
import { fetchNodeTelemetry, fetchNodes } from "@/api";
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

type TelemetryPercentMetric = "cpuUsage" | "ramUsage" | "diskUsage";

type FleetLatestTelemetry = Record<string, Telemetry | null>;

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
}: {
  title: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
}) {
  return (
    <Card size="sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center justify-between">
          <span className="text-muted-foreground font-medium">{title}</span>
          <Icon className="h-4 w-4 text-muted-foreground" />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold tracking-tight">{value}</div>
        {hint ? <div className="text-xs text-muted-foreground mt-1">{hint}</div> : null}
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
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1">
        {selectedNodes.length === 0 ? (
          <span className="text-sm text-muted-foreground">Select up to {maxSelected} nodes</span>
        ) : (
          selectedNodes.map((n) => (
            <Badge key={n.id} variant="secondary" className="font-normal">
              {n.hostname}
            </Badge>
          ))
        )}
      </div>

      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          className={cn(buttonVariants({ variant: "outline" }), "justify-start")}
        >
          <Network className="h-4 w-4 mr-2" />
          Choose nodes
        </PopoverTrigger>
        <PopoverContent className="p-0" align="start">
          <Command>
            <CommandInput placeholder="Search nodes…" />
            <CommandList>
              <CommandEmpty>No nodes found.</CommandEmpty>
              <CommandGroup heading="Nodes">
                <ScrollArea className="h-72">
                  {nodes.map((n) => {
                    const checked = selectedSet.has(n.id);
                    const disabled = !checked && selectedIds.length >= maxSelected;

                    return (
                      <CommandItem
                        key={n.id}
                        value={n.hostname}
                        data-checked={checked}
                        data-disabled={disabled}
                        onSelect={() => {
                          if (disabled) return;
                          const next = checked
                            ? selectedIds.filter((id) => id !== n.id)
                            : [...selectedIds, n.id];
                          onChange(next);
                        }}
                      >
                        <span className="truncate">{n.hostname}</span>
                        <span className="ml-auto text-xs text-muted-foreground font-mono">
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
  seriesByNode: Record<string, Telemetry[]>,
  metric: TelemetryPercentMetric
): Array<Record<string, number | string | null>> {
  // Build a union timeline.
  const map = new Map<string, Record<string, number | string | null>>();

  for (const [nodeId, series] of Object.entries(seriesByNode)) {
    for (const point of series) {
      const ts = point.timestamp;
      const row = map.get(ts) ?? { timestamp: ts };
      row[nodeId] = point[metric] ?? null;
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
  const [compareMetric, setCompareMetric] = useState<TelemetryPercentMetric>("cpuUsage");

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

    const avg = (metric: TelemetryPercentMetric): number | null => {
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
      { name: "Online", value: fleetStats.online, color: "hsl(var(--chart-2))" },
      { name: "Offline", value: fleetStats.offline, color: "hsl(var(--chart-5))" },
      { name: "Error", value: fleetStats.error, color: "hsl(var(--destructive))" },
      {
        name: "Other",
        value: Math.max(0, fleetStats.total - fleetStats.online - fleetStats.offline - fleetStats.error),
        color: "hsl(var(--muted-foreground))",
      },
    ].filter((x) => x.value > 0);

    return items;
  }, [fleetStats]);

  const compareTelemetryQueries = useQuery({
    queryKey: ["compareTelemetry", compareNodeIds, compareMetric],
    enabled: compareNodeIds.length > 0,
    queryFn: async () => {
      const series = await mapWithConcurrency(
        compareNodeIds,
        async (nodeId) => {
          const data = await fetchNodeTelemetry(nodeId, 60);
          // Reversed by API (desc). We want oldest->newest.
          return [nodeId, [...data].reverse()] as const;
        },
        { concurrency: 4 }
      );

      const byNode = Object.fromEntries(series) as Record<string, Telemetry[]>;
      const merged = mergeTelemetrySeries(byNode, compareMetric);
      return { byNode, merged };
    },
    staleTime: 5_000,
    refetchInterval: 20_000,
  });

  const compareChartConfig: ChartConfig = useMemo(() => {
    const palette = [
      "hsl(var(--chart-1))",
      "hsl(var(--chart-2))",
      "hsl(var(--chart-3))",
      "hsl(var(--chart-4))",
      "hsl(var(--chart-5))",
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

  const compareMetricLabel = compareMetric === "cpuUsage" ? "CPU" : compareMetric === "ramUsage" ? "RAM" : "Disk";

  const fleetBarConfig: ChartConfig = {
    cpu: { label: "CPU", color: "hsl(var(--chart-1))" },
    ram: { label: "RAM", color: "hsl(var(--chart-2))" },
    disk: { label: "Disk", color: "hsl(var(--chart-3))" },
  };

  const statusPieConfig: ChartConfig = {
    Online: { label: "Online", color: "hsl(var(--chart-2))" },
    Offline: { label: "Offline", color: "hsl(var(--chart-5))" },
    Error: { label: "Error", color: "hsl(var(--destructive))" },
    Other: { label: "Other", color: "hsl(var(--muted-foreground))" },
  };

  const isValidTab = (v: string): v is "fleet" | "node" | "compare" =>
    v === "fleet" || v === "node" || v === "compare";

  const isValidMetric = (v: string): v is TelemetryPercentMetric =>
    v === "cpuUsage" || v === "ramUsage" || v === "diskUsage";

  const isStatusPayload = (x: unknown): x is { name: string; value: number } => {
    if (!x || typeof x !== "object") return false;
    const obj = x as Record<string, unknown>;
    return typeof obj.name === "string" && typeof obj.value === "number";
  };

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground">
            Fleet-level, per-node, and comparative analytics across your ManLab nodes.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => navigate("/nodes")}>
          <BarChart3 className="h-4 w-4 mr-2" />
          Manage nodes
        </Button>
      </header>

      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(isValidTab(v) ? v : "fleet")}>
        <TabsList>
          <TabsTrigger value="fleet">Fleet</TabsTrigger>
          <TabsTrigger value="node">Per Node</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
        </TabsList>

        <TabsContent value="fleet" className="space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Nodes" value={`${fleetStats.total}`} icon={Activity} hint={nodesLoading ? "Loading…" : ""} />
            <StatCard title="Online" value={`${fleetStats.online}`} icon={Router} hint={fleetStats.total ? `${Math.round((fleetStats.online / fleetStats.total) * 100)}%` : ""} />
            <StatCard title="Avg CPU" value={percent(fleetStats.avgCpu)} icon={Cpu} hint={fleetTelemetryLoading ? "Updating…" : "Latest snapshot"} />
            <StatCard title="Hot CPU" value={`${fleetStats.hotCpu}`} icon={Thermometer} hint="≥ 80%" />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle className="text-base">Top nodes (latest)</CardTitle>
                <CardDescription>Highest CPU usage, with RAM/Disk alongside for context.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer id="fleet-top" config={fleetBarConfig} className="h-[320px] w-full">
                  <BarChart data={topCpuNodes} margin={{ left: 12, right: 12 }}>
                    <CartesianGrid vertical={false} />
                    <XAxis
                      dataKey="hostname"
                      tickLine={false}
                      axisLine={false}
                      interval={0}
                      tick={{ fontSize: 11 }}
                      height={60}
                      angle={-30}
                      textAnchor="end"
                    />
                    <YAxis tickLine={false} axisLine={false} domain={[0, 100]} />
                    <ChartTooltip
                      content={
                        <ChartTooltipContent
                          labelKey="hostname"
                          formatter={(value, name) => [percent(Number(value)), name]}
                        />
                      }
                    />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Bar dataKey="cpu" fill="var(--color-cpu)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="ram" fill="var(--color-ram)" radius={[6, 6, 0, 0]} />
                    <Bar dataKey="disk" fill="var(--color-disk)" radius={[6, 6, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Status distribution</CardTitle>
                <CardDescription>Current node state.</CardDescription>
              </CardHeader>
              <CardContent>
                <ChartContainer id="fleet-status" config={statusPieConfig} className="h-[320px]">
                  <PieChart>
                    <RechartsTooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.length) return null;

                        const first = payload[0];
                        const raw = first?.payload as unknown;
                        if (!isStatusPayload(raw)) return null;

                        return (
                          <div className="border-border/50 bg-background rounded-lg border px-2.5 py-1.5 text-xs shadow-xl">
                            <div className="font-medium">{raw.name}</div>
                            <div className="text-muted-foreground">{raw.value.toLocaleString()}</div>
                          </div>
                        );
                      }}
                    />
                    <Legend />
                    <Pie data={statusPie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={95} paddingAngle={2}>
                      {statusPie.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                  </PieChart>
                </ChartContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Fleet table</CardTitle>
              <CardDescription>
                Quick scan across nodes. Click a hostname to jump to node details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {nodesError ? (
                <div className="text-sm text-destructive">Failed to load nodes.</div>
              ) : (
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Node</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead className="text-right">CPU</TableHead>
                        <TableHead className="text-right">RAM</TableHead>
                        <TableHead className="text-right">Disk</TableHead>
                        <TableHead className="text-right">Temp</TableHead>
                        <TableHead className="text-right">Last seen</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {topCpuNodes.map((r) => (
                        <TableRow key={r.nodeId}>
                          <TableCell className="font-medium">
                            <Link className="hover:underline" to={`/nodes/${r.nodeId}`}>
                              {r.hostname}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Badge variant={r.status === "Online" ? "default" : r.status === "Offline" ? "destructive" : "secondary"}>
                              {r.status}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{percent(r.cpu)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{percent(r.ram)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">{percent(r.disk)}</TableCell>
                          <TableCell className="text-right font-mono tabular-nums">
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

          <Separator />

          <div className="text-xs text-muted-foreground">
            Note: Fleet analytics uses each node’s latest telemetry snapshot. For deeper history and enhanced telemetry (GPU/APM/etc), use the Per Node tab.
          </div>
        </TabsContent>

        <TabsContent value="node" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Per-node analytics</CardTitle>
              <CardDescription>
                Select a node to see full telemetry history, network, ping, and enhanced panels.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">Node</Badge>
                  <Select
                    value={effectiveSelectedNodeId}
                    onValueChange={(v) => setSelectedNodeId(v ?? "")}
                    disabled={!effectiveNodes.length}
                  >
                    <SelectTrigger className="w-[320px]">
                      <SelectValue>
                        {selectedNode
                          ? `${selectedNode.hostname} (${selectedNode.status})`
                          : "Select a node…"}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {effectiveNodes.map((n) => (
                        <SelectItem key={n.id} value={n.id}>
                          {n.hostname}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {effectiveSelectedNodeId ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => navigate(`/nodes/${effectiveSelectedNodeId}`)}
                  >
                    <Activity className="h-4 w-4 mr-2" />
                    Open node details
                  </Button>
                ) : null}
              </div>
            </CardContent>
          </Card>

          {effectiveSelectedNodeId ? (
            <NodeHealthTab nodeId={effectiveSelectedNodeId} />
          ) : (
            <div className="text-sm text-muted-foreground">No nodes available yet.</div>
          )}
        </TabsContent>

        <TabsContent value="compare" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Compare nodes</CardTitle>
              <CardDescription>
                Overlay time series across nodes (currently: CPU/RAM/Disk from telemetry history).
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2">
                  <NodeMultiSelect nodes={effectiveNodes} selectedIds={compareNodeIds} onChange={setCompareNodeIds} />
                </div>
                <div>
                  <div className="text-sm font-medium mb-2">Metric</div>
                  <Select
                    value={compareMetric}
                    onValueChange={(v) => setCompareMetric(isValidMetric(v ?? "") ? (v as TelemetryPercentMetric) : "cpuUsage")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cpuUsage">CPU Usage</SelectItem>
                      <SelectItem value="ramUsage">RAM Usage</SelectItem>
                      <SelectItem value="diskUsage">Disk Usage</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Separator />

              {compareNodeIds.length === 0 ? (
                <div className="text-sm text-muted-foreground">Pick at least one node to compare.</div>
              ) : compareTelemetryQueries.isError ? (
                <div className="text-sm text-destructive">Failed to load telemetry for comparison.</div>
              ) : (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">{compareMetricLabel} comparison</CardTitle>
                    <CardDescription>Last 60 telemetry points per node.</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <ChartContainer id="compare" config={compareChartConfig} className="h-[360px]">
                      <LineChart data={compareTelemetryQueries.data?.merged ?? []} margin={{ left: 12, right: 12 }}>
                        <CartesianGrid vertical={false} />
                        <XAxis
                          dataKey="timestamp"
                          tickLine={false}
                          axisLine={false}
                          tickFormatter={(v) => (typeof v === "string" ? formatShortTime(v) : String(v))}
                          minTickGap={18}
                        />
                        <YAxis tickLine={false} axisLine={false} domain={[0, 100]} />
                        <ChartTooltip
                          content={
                            <ChartTooltipContent
                              labelKey="timestamp"
                              labelFormatter={(v) => (typeof v === "string" ? format(new Date(v), "PPpp") : String(v))}
                              formatter={(value, name) => [percent(Number(value)), name]}
                            />
                          }
                        />
                        <ChartLegend content={<ChartLegendContent />} />

                        {compareNodeIds.slice(0, 5).map((nodeId) => (
                          <Line
                            key={nodeId}
                            type="monotone"
                            dataKey={nodeId}
                            stroke={`var(--color-${nodeId})`}
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                          />
                        ))}
                      </LineChart>
                    </ChartContainer>
                  </CardContent>
                </Card>
              )}
            </CardContent>
          </Card>

          <div className="text-xs text-muted-foreground">
            Coming soon: compare network throughput, ping latency, GPU utilization, and APM signals once we add fleet-friendly endpoints.
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
