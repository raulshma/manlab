import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, MemoryStick, Activity, Terminal, ArrowUp } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { ProcessTelemetry } from "@/types";
import { fetchNodes, fetchProcessTelemetry } from "@/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const TopProcessesWidget = memo(function TopProcessesWidget({ config, onConfigChange }: WidgetProps) {
  const nodeId = (config.nodeId as string) || "";
  const maxProcesses = (config.maxProcesses as number) ?? 5;
  const sortBy = (config.sortBy as string) ?? "cpu";

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
  });

  const { data: processes, isLoading } = useQuery({
    queryKey: ["processTelemetry", nodeId],
    queryFn: () => {
      if (!nodeId) return Promise.resolve(null);
      return fetchProcessTelemetry(nodeId);
    },
    enabled: !!nodeId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const selectedNode = nodes?.find((n) => n.id === nodeId);

  if (!nodeId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <Terminal className="h-4 w-4" />
          <span className="text-sm">Select a node to view top processes</span>
        </div>
        {nodes && nodes.length > 0 && (
          <Select
            value={nodeId}
            onValueChange={(value) => onConfigChange({ ...config, nodeId: value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a node" />
            </SelectTrigger>
            <SelectContent>
              {nodes.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.hostname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Terminal className="h-5 w-5 text-cyan-500" />
            Top Processes
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-8">
            <Activity className="h-6 w-6 text-muted-foreground/50 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground/70">Loading...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!processes || processes.length === 0) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Terminal className="h-5 w-5 text-cyan-500" />
            Top Processes
          </CardTitle>
          {selectedNode && (
            <div className="text-sm text-muted-foreground/70">
              {selectedNode.hostname}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-8 text-muted-foreground/70">
            <Terminal className="h-12 w-12 text-muted-foreground/30" />
            <p className="ml-2 text-sm">No process data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Sort processes based on config
  const sortedProcesses = [...processes].sort((a, b) => {
    if (sortBy === "cpu") {
      return (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0);
    } else if (sortBy === "memory") {
      return (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0);
    }
    return (a.processName ?? "").localeCompare(b.processName ?? "");
  }).slice(0, maxProcesses);

  return (
    <Card className="border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <Terminal className="h-5 w-5 text-cyan-500" />
              Top Processes
            </CardTitle>
            {selectedNode && (
              <div className="text-sm text-muted-foreground/70">
                {selectedNode.hostname} • {processes.length} total
              </div>
            )}
          </div>
          <div className="flex items-center gap-1 text-xs text-muted-foreground/60">
            {sortBy === "cpu" && <Cpu className="h-3 w-3" />}
            {sortBy === "memory" && <MemoryStick className="h-3 w-3" />}
            <span className="uppercase">{sortBy}</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="space-y-2">
          {sortedProcesses.map((process, index) => (
            <ProcessRow key={`${process.processId}-${index}`} process={process} sortBy={sortBy} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
});

function ProcessRow({ process, sortBy }: { process: ProcessTelemetry; sortBy: string }) {
  const name = process.processName || `PID ${process.processId}`;
  const cpuPercent = process.cpuPercent ?? 0;
  const memoryBytes = process.memoryBytes ?? 0;

  const formatMemory = (bytes: number): string => {
    if (bytes === 0) return "0 B";
    const mb = bytes / (1024 * 1024);
    if (mb < 1024) return `${mb.toFixed(1)} MB`;
    const gb = mb / 1024;
    return `${gb.toFixed(2)} GB`;
  };

  return (
    <div className="flex items-center gap-3 p-2 hover:bg-muted/30 rounded-lg transition-colors">
      <div className="flex-shrink-0 w-8 h-8 bg-muted/50 rounded-lg flex items-center justify-center">
        <span className="text-xs font-mono text-muted-foreground">{process.processId}</span>
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate" title={name}>
          {name}
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground/70 mt-0.5">
          {sortBy === "cpu" ? (
            <>
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3 text-blue-500" />
                {cpuPercent.toFixed(1)}%
              </span>
              <span className="flex items-center gap-1">
                <MemoryStick className="h-3 w-3 text-purple-500" />
                {formatMemory(memoryBytes)}
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <MemoryStick className="h-3 w-3 text-purple-500" />
                {formatMemory(memoryBytes)}
              </span>
              <span className="flex items-center gap-1">
                <Cpu className="h-3 w-3 text-blue-500" />
                {cpuPercent.toFixed(1)}%
              </span>
            </>
          )}
        </div>
      </div>

      <div className="flex-shrink-0">
        {sortBy === "cpu" && cpuPercent > 50 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded text-xs text-red-600">
            <ArrowUp className="h-3 w-3" />
            High CPU
          </div>
        )}
        {sortBy === "memory" && memoryBytes > 1024 * 1024 * 1024 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-orange-500/10 rounded text-xs text-orange-600">
            <ArrowUp className="h-3 w-3" />
            High RAM
          </div>
        )}
      </div>
    </div>
  );
}
