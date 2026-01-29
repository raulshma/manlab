import { useState, useMemo, memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Activity, Cpu, AlertTriangle, Filter, X } from "lucide-react";
import { fetchNodes, fetchProcessTelemetry } from "@/api";
import type { Node, ProcessTelemetry } from "@/types";
import { useSignalR } from "@/SignalRContext";

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

interface ProcessWithNode extends ProcessTelemetry {
  nodeId: string;
  nodeName: string;
}

// Memoized process row component to prevent re-renders
const ProcessRow = memo(function ProcessRow({
  process,
  isCpuAlert,
  isMemAlert,
}: {
  process: ProcessWithNode;
  isCpuAlert: boolean;
  isMemAlert: boolean;
}) {
  return (
    <TableRow>
      <TableCell className="font-medium">{process.processName ?? 'Unknown'}</TableCell>
      <TableCell>{process.processId}</TableCell>
      <TableCell>
        <Link
          to={`/nodes/${process.nodeId}`}
          className="text-primary hover:underline"
        >
          {process.nodeName}
        </Link>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span
          className={
            isCpuAlert ? "text-destructive font-bold" : undefined
          }
        >
          {formatPercent(process.cpuPercent)}
        </span>
      </TableCell>
      <TableCell className="text-right tabular-nums">
        <span
          className={
            isMemAlert ? "text-destructive font-bold" : undefined
          }
        >
          {formatBytes(process.memoryBytes)}
        </span>
      </TableCell>
      <TableCell>
        {(isCpuAlert || isMemAlert) && (
          <Badge variant="destructive">
            <AlertTriangle className="w-3 h-3 mr-1" />
            Alert
          </Badge>
        )}
      </TableCell>
    </TableRow>
  );
});

export function ProcessesPage() {
  const [selectedNodeId, setSelectedNodeId] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [minCpuFilter, setMinCpuFilter] = useState<number[]>([0]);
  const [minMemoryFilter, setMinMemoryFilter] = useState<number[]>([0]);
  const [showOnlyAlerts, setShowOnlyAlerts] = useState(false);

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: () => fetchNodes(),
    staleTime: 30_000,
  });

  // Fetch process telemetry for all nodes
  const nodesToFetch = nodes ?? [];
  const processQueries = useQuery({
    queryKey: ["processTelemetry", nodesToFetch.map((n) => n.id)],
    queryFn: async () => {
      const results = await Promise.allSettled(
        nodesToFetch.map(async (node) => {
          const processes = await fetchProcessTelemetry(node.id);
          return { node, processes: processes ?? [] };
        })
      );

      return results
        .filter((r): r is PromiseFulfilledResult<{ node: Node; processes: ProcessTelemetry[] }> =>
          r.status === "fulfilled"
        )
        .map((r) => r.value);
    },
    enabled: nodesToFetch.length > 0,
    refetchInterval: 10_000,
  });

  const { processAlerts } = useSignalR();

  // Flatten and aggregate process data
  const allProcesses: ProcessWithNode[] = useMemo(() => {
    if (!processQueries.data) return [];

    return processQueries.data.flatMap(({ node, processes }) =>
      processes.map((p) => ({
        ...p,
        nodeId: node.id,
        nodeName: node.hostname,
      }))
    );
  }, [processQueries.data]);

  // Filter processes
  const filteredProcesses = useMemo(() => {
    let filtered = allProcesses;

    // Node filter
    if (selectedNodeId !== "all") {
      filtered = filtered.filter((p) => p.nodeId === selectedNodeId);
    }

    // Search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter((p) =>
        p.processName?.toLowerCase().includes(query)
      );
    }

    // CPU filter
    if (minCpuFilter[0] > 0) {
      filtered = filtered.filter((p) => (p.cpuPercent ?? 0) >= minCpuFilter[0]);
    }

    // Memory filter
    if (minMemoryFilter[0] > 0) {
      filtered = filtered.filter((p) => (p.memoryBytes ?? 0) >= minMemoryFilter[0] * 1024 * 1024);
    }

    // Alerts filter
    if (showOnlyAlerts) {
      filtered = filtered.filter((p) => {
        const hasCpuAlert = (p.cpuPercent ?? 0) >= 80;
        const hasMemAlert = (p.memoryBytes ?? 0) >= 80;
        return hasCpuAlert || hasMemAlert;
      });
    }

    return filtered;
  }, [allProcesses, selectedNodeId, searchQuery, minCpuFilter, minMemoryFilter, showOnlyAlerts]);

  // Sort by CPU
  const sortedProcesses = useMemo(() => {
    return [...filteredProcesses].sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0));
  }, [filteredProcesses]);

  const clearFilters = () => {
    setSearchQuery("");
    setMinCpuFilter([0]);
    setMinMemoryFilter([0]);
    setShowOnlyAlerts(false);
    setSelectedNodeId("all");
  };

  const hasActiveFilters =
    searchQuery !== "" || minCpuFilter[0] > 0 || minMemoryFilter[0] > 0 || showOnlyAlerts || selectedNodeId !== "all";

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Process Monitoring</h1>
          <p className="text-muted-foreground">
            Real-time process monitoring across all nodes
          </p>
        </div>
        <Button variant="outline" onClick={() => window.location.href = '/settings'}>
          Configure Settings
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Filter className="w-4 h-4" />
            Filters
            {hasActiveFilters && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="ml-auto">
                <X className="w-4 h-4 mr-1" />
                Clear All
              </Button>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* Node Filter */}
            <div className="space-y-2">
              <Label>Node</Label>
              <Select
                value={selectedNodeId}
                onValueChange={(value) => setSelectedNodeId(value ?? 'all')}
              >
                <SelectTrigger>
                  <SelectValue placeholder="All nodes" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Nodes</SelectItem>
                  {nodes?.map((node) => (
                    <SelectItem key={node.id} value={node.id}>
                      {node.hostname}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Search Filter */}
            <div className="space-y-2">
              <Label>Search Process Name</Label>
              <Input
                placeholder="e.g., chrome, docker..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            {/* CPU Filter */}
            <div className="space-y-2">
              <Label>Min CPU Usage: {minCpuFilter[0]}%</Label>
              <Slider
                value={minCpuFilter}
                onValueChange={(value) => setMinCpuFilter(Array.isArray(value) ? value : [value])}
                min={0}
                max={100}
                step={5}
              />
            </div>

            {/* Memory Filter */}
            <div className="space-y-2">
              <Label>Min Memory: {minMemoryFilter[0]} MB</Label>
              <Slider
                value={minMemoryFilter}
                onValueChange={(value) => setMinMemoryFilter(Array.isArray(value) ? value : [value])}
                min={0}
                max={16384}
                step={256}
              />
            </div>

            {/* Alert Filter */}
            <div className="flex items-end">
              <Label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={showOnlyAlerts}
                  onChange={(e) => setShowOnlyAlerts(e.target.checked)}
                  className="rounded"
                />
                Show only alerts (CPU/Memory ≥ 80%)
              </Label>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Total Processes</p>
                <p className="text-2xl font-bold">{allProcesses.length}</p>
              </div>
              <Activity className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Filtered Results</p>
                <p className="text-2xl font-bold">{filteredProcesses.length}</p>
              </div>
              <Filter className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Nodes Monitored</p>
                <p className="text-2xl font-bold">{nodesToFetch.length}</p>
              </div>
              <Cpu className="w-8 h-8 text-muted-foreground" />
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">Active Alerts</p>
                <p className="text-2xl font-bold">{processAlerts.size}</p>
              </div>
              <AlertTriangle className="w-8 h-8 text-destructive" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Process Table */}
      <Card>
        <CardHeader>
          <CardTitle>Processes</CardTitle>
        </CardHeader>
        <CardContent>
          {processQueries.isLoading ? (
            <div className="text-center py-8 text-muted-foreground">Loading...</div>
          ) : sortedProcesses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              No processes found matching the current filters
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Process Name</TableHead>
                    <TableHead>PID</TableHead>
                    <TableHead>Node</TableHead>
                    <TableHead className="text-right">CPU %</TableHead>
                    <TableHead className="text-right">Memory</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sortedProcesses.map((process) => {
                    const cpuPercent = process.cpuPercent ?? 0;
                    const memBytes = process.memoryBytes ?? 0;
                    const isCpuAlert = cpuPercent >= 80;
                    const isMemAlert = memBytes >= 80 * 1024 * 1024; // 80MB threshold

                    return (
                      <ProcessRow
                        key={`${process.nodeId}-${process.processId}`}
                        process={process}
                        isCpuAlert={isCpuAlert}
                        isMemAlert={isMemAlert}
                      />
                    );
                  })}
                  {sortedProcesses.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center">
                        No processes found matching the current filters
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
