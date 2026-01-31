import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNodes } from "@/api";
import { 
  AlertTriangle, 
  AlertCircle, 
  CheckCircle2, 
  Server, 
  Cpu, 
  MemoryStick
} from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { Node } from "@/types";
import { formatDistanceToNow } from "date-fns";

interface AlertItem {
  id: string;
  type: "error" | "warning" | "offline" | "cpu" | "memory";
  nodeId: string;
  nodeHostname: string;
  message: string;
  timestamp: string;
  severity: "critical" | "warning" | "info";
}

export const AlertsWidget = memo(function AlertsWidget({ config }: WidgetProps) {
  const maxAlerts = (config.maxAlerts as number) || 10;

  const { data: nodes, isLoading } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const alerts = useMemo<AlertItem[]>(() => {
    if (!nodes) return [];

    const severityFilter = (config.severityFilter as string[]) || ["critical", "warning"];
    const items: AlertItem[] = [];

    nodes.forEach((node: Node) => {
      // Offline nodes
      if (node.status === "Offline") {
        items.push({
          id: `${node.id}-offline`,
          type: "offline",
          nodeId: node.id,
          nodeHostname: node.hostname,
          message: "Node is offline",
          timestamp: node.lastSeen,
          severity: "critical",
        });
      }

      // Error status nodes
      if (node.status === "Error" && node.errorMessage) {
        items.push({
          id: `${node.id}-error`,
          type: "error",
          nodeId: node.id,
          nodeHostname: node.hostname,
          message: node.errorMessage,
          timestamp: node.errorAt || node.lastSeen,
          severity: "critical",
        });
      }
    });

    // Sort by severity and timestamp
    return items
      .filter((alert) => severityFilter.includes(alert.severity))
      .sort((a, b) => {
        const severityOrder = { critical: 0, warning: 1, info: 2 };
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
      })
      .slice(0, maxAlerts);
  }, [nodes, maxAlerts, config.severityFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  if (alerts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
        <div className="p-3 bg-green-500/10 rounded-full">
          <CheckCircle2 className="h-8 w-8 text-green-500" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-green-600">All Systems Normal</p>
          <p className="text-xs text-muted-foreground">No active alerts</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2 overflow-y-auto h-full">
      {alerts.map((alert) => (
        <AlertCard key={alert.id} alert={alert} />
      ))}
      {alerts.length >= maxAlerts && (
        <p className="text-xs text-center text-muted-foreground pt-2">
          Showing top {maxAlerts} alerts
        </p>
      )}
    </div>
  );
});

function AlertCard({ alert }: { alert: AlertItem }) {
  const getIcon = () => {
    switch (alert.type) {
      case "error":
        return <AlertCircle className="h-4 w-4" />;
      case "offline":
        return <Server className="h-4 w-4" />;
      case "cpu":
        return <Cpu className="h-4 w-4" />;
      case "memory":
        return <MemoryStick className="h-4 w-4" />;
      default:
        return <AlertTriangle className="h-4 w-4" />;
    }
  };

  const getColors = () => {
    switch (alert.severity) {
      case "critical":
        return "bg-red-500/10 border-red-500/30 text-red-600";
      case "warning":
        return "bg-amber-500/10 border-amber-500/30 text-amber-600";
      default:
        return "bg-blue-500/10 border-blue-500/30 text-blue-600";
    }
  };

  const timeAgo = formatDistanceToNow(new Date(alert.timestamp), { addSuffix: true });

  return (
    <div className={`flex items-start gap-3 p-3 rounded-lg border ${getColors()} hover:opacity-80 transition-opacity`}>
      <div className="flex-shrink-0 mt-0.5">{getIcon()}</div>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-semibold truncate">{alert.nodeHostname}</span>
          <span className="text-xs opacity-70 whitespace-nowrap">{timeAgo}</span>
        </div>
        <p className="text-xs leading-relaxed opacity-90">{alert.message}</p>
      </div>
    </div>
  );
}
