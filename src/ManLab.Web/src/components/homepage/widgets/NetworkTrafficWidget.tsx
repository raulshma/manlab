import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Network, ArrowDown, ArrowUp, Activity } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { NetworkTelemetryPoint } from "@/types";
import { fetchNodes, fetchNodeNetworkTelemetry } from "@/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const NetworkTrafficWidget = memo(function NetworkTrafficWidget({ config, onConfigChange }: WidgetProps) {
  const nodeId = (config.nodeId as string) || "";
  const showHistory = (config.showHistory as boolean) ?? true;

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
  });

  const { data: networkData, isLoading } = useQuery({
    queryKey: ["networkTelemetry", nodeId],
    queryFn: () => {
      if (!nodeId) return Promise.resolve(null);
      return fetchNodeNetworkTelemetry(nodeId, 60);
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
          <Network className="h-4 w-4" />
          <span className="text-sm">Select a node to monitor network traffic</span>
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
            <Network className="h-5 w-5 text-blue-500" />
            Network Traffic
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

  const latest = networkData?.[networkData.length - 1];

  if (!latest) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <Network className="h-5 w-5 text-blue-500" />
            Network Traffic
          </CardTitle>
          {selectedNode && (
            <div className="text-sm text-muted-foreground/70">
              {selectedNode.hostname}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-8 text-muted-foreground/70">
            <Network className="h-12 w-12 text-muted-foreground/30" />
            <p className="ml-2 text-sm">No network data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const formatBytesPerSecond = (bytesPerSec: number | null): string => {
    if (bytesPerSec === null || bytesPerSec === 0) return "0 B/s";
    const k = 1024;
    const sizes = ["B/s", "KB/s", "MB/s", "GB/s"];
    const i = Math.floor(Math.log(bytesPerSec) / Math.log(k));
    return `${(bytesPerSec / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
  };

  const rxRate = latest.netRxBytesPerSec ?? 0;
  const txRate = latest.netTxBytesPerSec ?? 0;

  return (
    <Card className="border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <Network className="h-5 w-5 text-blue-500" />
              Network Traffic
            </CardTitle>
            {selectedNode && (
              <div className="text-sm text-muted-foreground/70">
                {selectedNode.hostname}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            <div className="w-2 h-2 rounded-full bg-green-500" />
            <span className="text-xs text-muted-foreground/60">Active</span>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground/70">
              <ArrowDown className="h-4 w-4 text-green-500" />
              <span className="text-xs uppercase tracking-wide">Download</span>
            </div>
            <div className="text-2xl font-bold text-green-600">
              {formatBytesPerSecond(rxRate)}
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-muted-foreground/70">
              <ArrowUp className="h-4 w-4 text-blue-500" />
              <span className="text-xs uppercase tracking-wide">Upload</span>
            </div>
            <div className="text-2xl font-bold text-blue-600">
              {formatBytesPerSecond(txRate)}
            </div>
          </div>
        </div>

        {showHistory && networkData && networkData.length > 1 && (
          <div className="pt-2">
            <div className="text-xs text-muted-foreground/70 mb-2">Traffic History (5 min)</div>
            <NetworkMiniChart data={networkData.slice(-30)} />
          </div>
        )}
      </CardContent>
    </Card>
  );
});

function NetworkMiniChart({ data }: { data: NetworkTelemetryPoint[] }) {
  if (data.length < 2) return null;

  const rates = [];
  for (let i = 0; i < data.length; i++) {
    rates.push({
      rx: data[i].netRxBytesPerSec ?? 0,
      tx: data[i].netTxBytesPerSec ?? 0,
    });
  }

  if (rates.length === 0) return null;

  const maxRx = Math.max(...rates.map(r => r.rx), 1);
  const maxTx = Math.max(...rates.map(r => r.tx), 1);
  const maxVal = Math.max(maxRx, maxTx);

  const chartHeight = 60;
  const chartWidth = 280;
  const barWidth = chartWidth / rates.length;

  return (
    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} className="w-full h-[60px]">
      {rates.map((rate, i) => {
        const rxHeight = (rate.rx / maxVal) * (chartHeight / 2 - 2);
        const txHeight = (rate.tx / maxVal) * (chartHeight / 2 - 2);
        const x = i * barWidth + barWidth * 0.1;
        const barW = barWidth * 0.8;

        return (
          <g key={i}>
            {/* RX bar (top half) */}
            <rect
              x={x}
              y={chartHeight / 2 - rxHeight}
              width={barW}
              height={rxHeight}
              fill="#22c55e"
              opacity={0.7}
              rx={1}
            />
            {/* TX bar (bottom half) */}
            <rect
              x={x}
              y={chartHeight / 2 + 2}
              width={barW}
              height={txHeight}
              fill="#3b82f6"
              opacity={0.7}
              rx={1}
            />
          </g>
        );
      })}
      {/* Center line */}
      <line
        x1={0}
        y1={chartHeight / 2}
        x2={chartWidth}
        y2={chartHeight / 2}
        stroke="currentColor"
        strokeOpacity={0.2}
        strokeWidth={1}
      />
    </svg>
  );
}
