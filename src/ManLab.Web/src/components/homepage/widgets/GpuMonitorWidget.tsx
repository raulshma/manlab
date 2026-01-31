import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, Thermometer, Activity, Monitor } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { EnhancedGpuTelemetry } from "@/types";
import { fetchNodes, fetchEnhancedGpuTelemetry } from "@/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const GpuMonitorWidget = memo(function GpuMonitorWidget({ config, onConfigChange }: WidgetProps) {
  const nodeId = (config.nodeId as string) || "";
  const showAllGpus = (config.showAllGpus as boolean) ?? true;

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
  });

  const { data: gpuData, isLoading } = useQuery({
    queryKey: ["gpuTelemetry", nodeId],
    queryFn: () => {
      if (!nodeId) return Promise.resolve(null);
      return fetchEnhancedGpuTelemetry(nodeId);
    },
    enabled: !!nodeId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const selectedNode = nodes?.find((n) => n.id === nodeId);
  const hasGpuCapability = selectedNode?.capabilities?.tools?.nvidiaSmi ?? false;

  if (!nodeId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <Monitor className="h-4 w-4" />
          <span className="text-sm">Select a node to monitor GPU status</span>
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
            <Monitor className="h-5 w-5 text-purple-500" />
            GPU Monitor
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

  if (!hasGpuCapability) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5 text-purple-500" />
            GPU Monitor
          </CardTitle>
          {selectedNode && (
            <div className="text-sm text-muted-foreground/70">
              {selectedNode.hostname}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/70 space-y-2">
            <Monitor className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm">No GPU monitoring available</p>
            <p className="text-xs text-muted-foreground/50">This node does not have NVIDIA GPUs or nvidia-smi is not installed</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!gpuData || gpuData.length === 0) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Monitor className="h-5 w-5 text-purple-500" />
            GPU Monitor
          </CardTitle>
          {selectedNode && (
            <div className="text-sm text-muted-foreground/70">
              {selectedNode.hostname}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-8 text-muted-foreground/70">
            <Monitor className="h-12 w-12 text-muted-foreground/30" />
            <p className="ml-2 text-sm">No GPU data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const gpusToShow = showAllGpus ? gpuData : gpuData.slice(0, 1);

  return (
    <Card className="border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <Monitor className="h-5 w-5 text-purple-500" />
              GPU Monitor
            </CardTitle>
            {selectedNode && (
              <div className="text-sm text-muted-foreground/70">
                {selectedNode.hostname}
                {gpuData.length > 1 && ` • ${gpuData.length} GPUs detected`}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {gpusToShow.map((gpu, index) => (
          <GpuCard key={gpu.index ?? index} gpu={gpu} index={index} />
        ))}
      </CardContent>
    </Card>
  );
});

function GpuCard({ gpu, index }: { gpu: EnhancedGpuTelemetry; index: number }) {
  const utilization = gpu.utilizationPercent ?? 0;
  const temperature = gpu.temperatureC ?? 0;
  const memoryUsed = gpu.memoryUsedBytes ?? 0;
  const memoryTotal = gpu.memoryTotalBytes ?? 1;
  const memoryPercent = memoryTotal > 0 ? (memoryUsed / memoryTotal) * 100 : 0;
  const powerDraw = gpu.powerDrawWatts ?? 0;

  const getTempColor = (temp: number): string => {
    if (temp < 60) return "text-green-500";
    if (temp < 80) return "text-yellow-500";
    return "text-red-500";
  };

  return (
    <div className="p-3 bg-muted/20 rounded-lg space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-purple-500" />
          <span className="text-sm font-medium">
            {gpu.name || `GPU ${gpu.index ?? index}`}
          </span>
        </div>
        <div className={`flex items-center gap-1 px-2 py-1 rounded text-xs ${getTempColor(temperature)} bg-opacity-10`}>
          <Thermometer className="h-3 w-3" />
          <span>{temperature.toFixed(0)}°C</span>
        </div>
      </div>

      <div className="space-y-2">
        {/* Utilization */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground/70 flex items-center gap-1">
              <Cpu className="h-3 w-3" />
              Utilization
            </span>
            <span className="font-medium">{utilization.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-500 rounded-full transition-all duration-500"
              style={{ width: `${utilization}%` }}
            />
          </div>
        </div>

        {/* Memory */}
        <div className="space-y-1">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground/70">Memory</span>
            <span className="font-medium">{memoryPercent.toFixed(0)}%</span>
          </div>
          <div className="h-1.5 bg-muted/50 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${memoryPercent}%` }}
            />
          </div>
          <div className="text-xs text-muted-foreground/50">
            {formatBytes(memoryUsed)} / {formatBytes(memoryTotal)}
          </div>
        </div>

        {/* Power */}
        {powerDraw > 0 && (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted-foreground/70">Power</span>
              <span className="font-medium">{powerDraw.toFixed(0)}W</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}
