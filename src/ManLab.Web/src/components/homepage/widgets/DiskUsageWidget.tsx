import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNodes, fetchNodeTelemetry } from "@/api";
import { 
  HardDrive, 
  AlertTriangle, 
  CheckCircle2,
  Server
} from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { Node } from "@/types";

interface DiskUsageItem {
  nodeId: string;
  hostname: string;
  usage: number;
  status: "normal" | "warning" | "critical";
  isOffline: boolean;
}

export const DiskUsageWidget = memo(function DiskUsageWidget({ config }: WidgetProps) {
  const showAllNodes = (config.showAllNodes as boolean) ?? true;
  const warningThreshold = (config.warningThreshold as number) || 80;
  const criticalThreshold = (config.criticalThreshold as number) || 90;

  const { data: nodes, isLoading: nodesLoading } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  const { data: telemetryData, isLoading: telemetryLoading } = useQuery({
    queryKey: ["diskUsageTelemetry", nodes?.map((n: Node) => n.id).join(",")],
    queryFn: async () => {
      if (!nodes || nodes.length === 0) return [];
      const telemetryPromises = nodes.map(async (node: Node) => {
        try {
          const telemetry = await fetchNodeTelemetry(node.id, 1);
          return { nodeId: node.id, telemetry: telemetry[0] || null };
        } catch {
          return { nodeId: node.id, telemetry: null };
        }
      });
      return Promise.all(telemetryPromises);
    },
    enabled: !!nodes && nodes.length > 0,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  // Calculate disk usages from telemetry data
  const diskUsages: DiskUsageItem[] = (() => {
    if (!nodes) return [];

    return nodes.map((node: Node) => {
      const nodeTelemetry = telemetryData?.find((t) => t.nodeId === node.id);
      const usage = nodeTelemetry?.telemetry?.diskUsage ?? 0;

      let status: "normal" | "warning" | "critical" = "normal";
      if (node.status === "Offline") {
        status = "normal";
      } else if (usage >= criticalThreshold) {
        status = "critical";
      } else if (usage >= warningThreshold) {
        status = "warning";
      }

      return {
        nodeId: node.id,
        hostname: node.hostname,
        usage,
        status,
        isOffline: node.status === "Offline",
      };
    });
  })();

  const visibleUsages = showAllNodes 
    ? diskUsages.sort((a, b) => b.usage - a.usage)
    : diskUsages.filter((d) => d.status !== "normal" || d.isOffline).sort((a, b) => {
        const statusOrder = { critical: 0, warning: 1, normal: 2 };
        return statusOrder[a.status] - statusOrder[b.status];
      });

  const summary = {
    total: diskUsages.length,
    critical: diskUsages.filter((d) => d.status === "critical" && !d.isOffline).length,
    warning: diskUsages.filter((d) => d.status === "warning" && !d.isOffline).length,
    offline: diskUsages.filter((d) => d.isOffline).length,
  };

  if (nodesLoading || telemetryLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3 h-full overflow-y-auto">
      {/* Summary Bar */}
      <div className="flex items-center gap-2 pb-2 border-b border-border/30">
        {summary.critical > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded text-xs text-red-600">
            <AlertTriangle className="h-3 w-3" />
            <span>{summary.critical} Critical</span>
          </div>
        )}
        {summary.warning > 0 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-amber-500/10 rounded text-xs text-amber-600">
            <AlertTriangle className="h-3 w-3" />
            <span>{summary.warning} Warning</span>
          </div>
        )}
        {summary.critical === 0 && summary.warning === 0 && (
          <div className="flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded text-xs text-green-600">
            <CheckCircle2 className="h-3 w-3" />
            <span>All Normal</span>
          </div>
        )}
        <div className="text-xs text-muted-foreground ml-auto">
          {summary.total} nodes
        </div>
      </div>

      {/* Disk Usage List */}
      <div className="space-y-2">
        {visibleUsages.map((item) => (
          <DiskUsageBar key={item.nodeId} item={item} />
        ))}
      </div>

      {!showAllNodes && visibleUsages.length === 0 && diskUsages.length > 0 && (
        <div className="flex flex-col items-center justify-center py-4 text-center space-y-2">
          <CheckCircle2 className="h-8 w-8 text-green-500" />
          <p className="text-sm text-muted-foreground">No disk usage issues</p>
        </div>
      )}
    </div>
  );
});

function DiskUsageBar({ item }: { item: DiskUsageItem }) {
  const getColorClass = () => {
    if (item.isOffline) return "bg-gray-400";
    if (item.status === "critical") return "bg-red-500";
    if (item.status === "warning") return "bg-amber-500";
    return "bg-green-500";
  };

  const getBgClass = () => {
    if (item.isOffline) return "bg-gray-100 dark:bg-gray-800";
    if (item.status === "critical") return "bg-red-50 dark:bg-red-950/20";
    if (item.status === "warning") return "bg-amber-50 dark:bg-amber-950/20";
    return "bg-green-50 dark:bg-green-950/20";
  };

  return (
    <div className={`p-2 rounded-lg ${getBgClass()}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="flex items-center gap-2">
          {item.isOffline ? (
            <Server className="h-4 w-4 text-gray-400" />
          ) : (
            <HardDrive className={`h-4 w-4 ${item.status === "critical" ? "text-red-500" : item.status === "warning" ? "text-amber-500" : "text-green-500"}`} />
          )}
          <span className="text-sm font-medium truncate">{item.hostname}</span>
        </div>
        <span className={`text-sm font-semibold ${item.isOffline ? "text-gray-400" : ""}`}>
          {item.isOffline ? "—" : `${item.usage.toFixed(1)}%`}
        </span>
      </div>
      <div className="h-2 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${getColorClass()}`}
          style={{ width: item.isOffline ? "0%" : `${Math.min(item.usage, 100)}%` }}
        />
      </div>
    </div>
  );
}
