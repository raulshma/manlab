import { useMemo } from "react";
import { useNavigate, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import { LocalAgentCard } from "@/components/LocalAgentCard";
import { NodeGrid } from "@/components/NodeGrid";
import { DashboardStatsCard } from "@/components/dashboard/DashboardStatsCard";
import { IssuesPanel } from "@/components/dashboard/IssuesPanel";
import { FleetHealthChart } from "@/components/dashboard/FleetHealthChart";
import { ServerResourceUsagePanel } from "@/components/ServerResourceUsagePanel";
import { fetchNodes, fetchNodeTelemetry } from "@/api";
import { mapWithConcurrency } from "@/lib/async";
import type { Node, Telemetry } from "@/types";
import { cn } from "@/lib/utils";
import { useSignalR } from "@/SignalRContext";
import {
  Server,
  Activity,
  Cpu,
  AlertTriangle,
  BarChart3,
  HardDrive,
  MemoryStick,
  Thermometer,
  Plus,
} from "lucide-react";

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
        return [nodeId, null] as const;
      }
    },
    { concurrency: 6 }
  );
  return Object.fromEntries(rows);
}

function percent(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function formatShortTime(ts: string): string {
  try {
    const date = new Date(ts);
    return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return ts;
  }
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { serverResourceUsage } = useSignalR();

  // Fetch nodes
  const {
    data: nodes,
    isLoading: nodesLoading,
  } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const effectiveNodes = useMemo(() => nodes ?? [], [nodes]);

  // Fetch latest telemetry for each node
  const { data: latestTelemetry, isLoading: telemetryLoading } = useQuery({
    queryKey: ["fleetLatestTelemetry", effectiveNodes.map((n) => n.id)],
    queryFn: () => fetchFleetLatestTelemetry(effectiveNodes),
    enabled: effectiveNodes.length > 0,
    staleTime: 5_000,
    refetchInterval: 30_000,
  });

  // Compute fleet statistics
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

    const avgTemp = (): number | null => {
      if (!rows.length) return null;
      const values = rows
        .map((r) => r.telemetry?.temperature)
        .filter((v): v is number => typeof v === "number");
      if (!values.length) return null;
      return values.reduce((a, b) => a + b, 0) / values.length;
    };

    const issuesCount = error + offline + rows.filter((r) => (r.telemetry?.cpuUsage ?? 0) >= 80).length;

    return {
      total,
      online,
      offline,
      error,
      avgCpu: avg("cpuUsage"),
      avgRam: avg("ramUsage"),
      avgDisk: avg("diskUsage"),
      avgTemp: avgTemp(),
      issuesCount,
      rows,
    };
  }, [effectiveNodes, latestTelemetry]);

  // Top nodes by CPU usage
  const topCpuNodes = useMemo(() => {
    return [...fleetStats.rows]
      .sort((a, b) => (b.telemetry?.cpuUsage ?? 0) - (a.telemetry?.cpuUsage ?? 0))
      .slice(0, 5)
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

  const isLoading = nodesLoading || telemetryLoading;

  return (
    <div className="min-h-screen bg-background/50">
      <div className="mx-auto max-w-7xl space-y-8 p-4 md:p-6 lg:p-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <h1 className="text-3xl font-extrabold tracking-tight bg-clip-text text-transparent bg-linear-to-r from-primary to-primary/60">
              Dashboard
            </h1>
            <p className="text-muted-foreground text-lg font-light max-w-2xl">
              Infrastructure overview and real-time monitoring
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" size="sm" onClick={() => navigate("/analytics")} className="h-9">
              <BarChart3 className="h-4 w-4 mr-2 text-muted-foreground" />
              Analytics
            </Button>
            <Link to="/onboarding">
                <Button size="sm" className="h-9 shadow-lg shadow-primary/20">
                    <Plus className="h-4 w-4 mr-2" />
                    Onboard Machine
                </Button>
            </Link>
          </div>
        </header>

        <Separator className="bg-border/40" />

        {/* Hero Stats Row */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 md:gap-6">
          <DashboardStatsCard
            title="Total Nodes"
            value={`${fleetStats.total}`}
            icon={Server}
            hint="Managed devices"
            accentColor="primary"
            isLoading={nodesLoading}
          />
          <DashboardStatsCard
            title="Online"
            value={`${fleetStats.online}`}
            icon={Activity}
            hint={fleetStats.total ? `${Math.round((fleetStats.online / fleetStats.total) * 100)}% uptime` : "—"}
            trend={fleetStats.online === fleetStats.total && fleetStats.total > 0 ? "up" : fleetStats.offline > 0 ? "down" : "neutral"}
            trendLabel={fleetStats.online === fleetStats.total && fleetStats.total > 0 ? "All Online" : fleetStats.offline > 0 ? `${fleetStats.offline} offline` : "—"}
            accentColor="emerald"
            isLoading={nodesLoading}
          />
          <DashboardStatsCard
            title="Avg Fleet CPU"
            value={percent(fleetStats.avgCpu)}
            icon={Cpu}
            hint="Real-time average"
            trend={fleetStats.avgCpu !== null ? (fleetStats.avgCpu > 80 ? "down" : "up") : "neutral"}
            trendLabel={fleetStats.avgCpu !== null ? (fleetStats.avgCpu > 80 ? "High Load" : "Healthy") : undefined}
            accentColor={fleetStats.avgCpu !== null && fleetStats.avgCpu > 80 ? "rose" : "primary"}
            isLoading={isLoading}
          />
          <DashboardStatsCard
            title="Issues"
            value={`${fleetStats.issuesCount}`}
            icon={AlertTriangle}
            hint="Errors, offline, high load"
            trend={fleetStats.issuesCount > 0 ? "down" : "up"}
            trendLabel={fleetStats.issuesCount === 0 ? "All Clear" : "Needs Attention"}
            accentColor={fleetStats.issuesCount > 0 ? "amber" : "emerald"}
            isLoading={isLoading}
          />
        </div>

        {/* Main Content Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Fleet Health Chart */}
          <FleetHealthChart nodes={effectiveNodes} isLoading={nodesLoading} />

          {/* Issues Panel */}
          <IssuesPanel
            nodes={effectiveNodes}
            telemetry={latestTelemetry ?? {}}
            isLoading={isLoading}
          />

          {/* Quick Metrics */}
          <Card className="border shadow-sm">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Cpu className="h-4 w-4 text-muted-foreground" />
                Fleet Metrics
              </CardTitle>
              <CardDescription>Average resource utilization</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {/* RAM */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="p-1.5 rounded-full bg-chart-2/10">
                      <MemoryStick className="h-3.5 w-3.5 text-chart-2" />
                    </div>
                    <span className="text-muted-foreground">Memory</span>
                  </div>
                  <span className="text-sm font-mono font-medium tabular-nums">
                    {percent(fleetStats.avgRam)}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-chart-2 rounded-full transition-all duration-500"
                    style={{ width: `${fleetStats.avgRam ?? 0}%` }}
                  />
                </div>

                {/* Disk */}
                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="p-1.5 rounded-full bg-chart-3/10">
                      <HardDrive className="h-3.5 w-3.5 text-chart-3" />
                    </div>
                    <span className="text-muted-foreground">Disk</span>
                  </div>
                  <span className="text-sm font-mono font-medium tabular-nums">
                    {percent(fleetStats.avgDisk)}
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full bg-chart-3 rounded-full transition-all duration-500"
                    style={{ width: `${fleetStats.avgDisk ?? 0}%` }}
                  />
                </div>

                {/* Temperature */}
                <div className="flex items-center justify-between mt-4">
                  <div className="flex items-center gap-2 text-sm">
                    <div className="p-1.5 rounded-full bg-chart-4/10">
                      <Thermometer className="h-3.5 w-3.5 text-chart-4" />
                    </div>
                    <span className="text-muted-foreground">Avg Temp</span>
                  </div>
                  <span className="text-sm font-mono font-medium tabular-nums">
                    {fleetStats.avgTemp !== null ? `${fleetStats.avgTemp.toFixed(1)}°C` : "—"}
                  </span>
                </div>
                {fleetStats.avgTemp !== null && (
                  <div className="h-2 bg-muted rounded-full overflow-hidden">
                    <div
                      className="h-full bg-chart-4 rounded-full transition-all duration-500"
                      style={{ width: `${Math.min((fleetStats.avgTemp / 100) * 100, 100)}%` }}
                    />
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        <ServerResourceUsagePanel data={serverResourceUsage} />

        {/* Top Nodes Table */}
        {topCpuNodes.length > 0 && (
          <Card className="border shadow-sm overflow-hidden">
            <CardHeader className="bg-muted/30 border-b pb-4">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base">Resource Leaders</CardTitle>
                  <CardDescription>Top 5 nodes by CPU utilization</CardDescription>
                </div>
                <Button variant="ghost" size="sm" onClick={() => navigate("/analytics")}>
                  View All
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader className="bg-muted/10">
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="w-48">Node</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">CPU</TableHead>
                      <TableHead className="text-right">RAM</TableHead>
                      <TableHead className="text-right">Disk</TableHead>
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
                            <span className="truncate">{r.hostname}</span>
                          </Link>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <div
                              className={cn(
                                "h-2 w-2 rounded-full",
                                r.status === "Online" && "bg-emerald-500",
                                r.status === "Offline" && "bg-destructive",
                                r.status === "Error" && "bg-destructive",
                                !["Online", "Offline", "Error"].includes(r.status) && "bg-yellow-500"
                              )}
                            />
                            <span className="text-sm text-muted-foreground">{r.status}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          <span className={cn(r.cpu > 80 ? "text-destructive font-bold" : "text-foreground/80")}>
                            {percent(r.cpu)}
                          </span>
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-foreground/80">
                          {percent(r.ram)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums text-foreground/80">
                          {percent(r.disk)}
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground font-mono">
                          {formatShortTime(r.lastSeen)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Local Agent Card */}
        <section className="space-y-4">
          <LocalAgentCard />
        </section>

        {/* Registered Nodes */}
        <section className="space-y-4 pt-2">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Registered Nodes</h2>
            <Button variant="ghost" size="sm" onClick={() => navigate("/nodes")}>
              View All
            </Button>
          </div>
          <NodeGrid onSelectNode={(nodeId) => navigate(`/nodes/${nodeId}`)} />
        </section>
      </div>
    </div>
  );
}
