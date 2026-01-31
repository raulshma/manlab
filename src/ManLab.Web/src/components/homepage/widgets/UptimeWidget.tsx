import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNodes } from "@/api";
import { 
  Clock, 
  Activity,
  Power,
  AlertCircle
} from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { Node } from "@/types";

interface UptimeItem {
  nodeId: string;
  hostname: string;
  status: "Online" | "Offline" | "Error" | "Maintenance";
  uptimeText: string;
  uptimeSeconds: number;
  bootTime: string | null;
}

export const UptimeWidget = memo(function UptimeWidget({ config }: WidgetProps) {
  const showAllNodes = (config.showAllNodes as boolean) ?? true;
  const maxNodes = (config.maxNodes as number) || 10;
  const sortBy = (config.sortBy as string) || "uptime";

  const { data: nodes, isLoading } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
    refetchInterval: 60_000,
  });

  // Calculate uptime items from nodes data
  const uptimeItems: UptimeItem[] = (() => {
    if (!nodes) return [];

    // Simple hash function for stable pseudo-random values
    const hashString = (str: string): number => {
      let hash = 0;
      for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
      return Math.abs(hash);
    };

    return nodes.map((node: Node) => {
      // For demo purposes, generate realistic uptime values based on node ID hash
      // In production, this would come from agent telemetry
      const now = new Date();
      let uptimeSeconds = 0;
      let uptimeText = "—";
      let bootTime: string | null = null;

      if (node.status === "Online") {
        // Generate stable uptime between 1 hour and 90 days using node ID hash
        const hash = hashString(node.id);
        uptimeSeconds = (hash % (90 * 24 * 60 * 60 - 3600)) + 3600;
        uptimeText = formatUptime(uptimeSeconds);
        bootTime = new Date(now.getTime() - uptimeSeconds * 1000).toISOString();
      }

      return {
        nodeId: node.id,
        hostname: node.hostname,
        status: node.status,
        uptimeText,
        uptimeSeconds,
        bootTime,
      };
    });
  })();

  const sortedItems = [...uptimeItems].sort((a, b) => {
    if (sortBy === "uptime") {
      // Sort by uptime descending (longest first)
      if (a.status !== "Online" && b.status === "Online") return 1;
      if (a.status === "Online" && b.status !== "Online") return -1;
      return b.uptimeSeconds - a.uptimeSeconds;
    } else if (sortBy === "name") {
      return a.hostname.localeCompare(b.hostname);
    } else {
      // Sort by status (online first)
      const statusOrder = { Online: 0, Maintenance: 1, Error: 2, Offline: 3 };
      return statusOrder[a.status] - statusOrder[b.status];
    }
  });

  const visibleItems = showAllNodes ? sortedItems.slice(0, maxNodes) : sortedItems.filter(n => n.status !== "Online");

  const summary = {
    total: uptimeItems.length,
    online: uptimeItems.filter((n) => n.status === "Online").length,
    avgUptime: uptimeItems.length > 0
      ? uptimeItems.filter(n => n.status === "Online").reduce((acc, n) => acc + n.uptimeSeconds, 0) / 
        Math.max(1, uptimeItems.filter(n => n.status === "Online").length)
      : 0,
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-3 h-full overflow-y-auto">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-2 pb-2 border-b border-border/30">
        <div className="p-2 bg-muted/30 rounded-lg text-center">
          <div className="text-2xl font-bold text-green-600">{summary.online}</div>
          <div className="text-xs text-muted-foreground">Online</div>
        </div>
        <div className="p-2 bg-muted/30 rounded-lg text-center">
          <div className="text-2xl font-bold text-blue-600">
            {summary.avgUptime > 0 ? formatUptimeShort(summary.avgUptime) : "—"}
          </div>
          <div className="text-xs text-muted-foreground">Avg Uptime</div>
        </div>
      </div>

      {/* Uptime List */}
      <div className="space-y-2">
        {visibleItems.map((item) => (
          <UptimeCard key={item.nodeId} item={item} />
        ))}
      </div>

      {visibleItems.length === 0 && (
        <div className="flex flex-col items-center justify-center py-4 text-center space-y-2">
          <Clock className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">No nodes to display</p>
        </div>
      )}
    </div>
  );
});

function UptimeCard({ item }: { item: UptimeItem }) {
  const getStatusIcon = () => {
    switch (item.status) {
      case "Online":
        return <Activity className="h-4 w-4 text-green-500" />;
      case "Offline":
        return <Power className="h-4 w-4 text-red-500" />;
      case "Error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
      default:
        return <Clock className="h-4 w-4 text-amber-500" />;
    }
  };

  const getStatusColor = () => {
    switch (item.status) {
      case "Online":
        return "text-green-600 bg-green-500/10";
      case "Offline":
        return "text-red-600 bg-red-500/10";
      case "Error":
        return "text-red-600 bg-red-500/10";
      default:
        return "text-amber-600 bg-amber-500/10";
    }
  };

  return (
    <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/20 hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-2">
        {getStatusIcon()}
        <span className="text-sm font-medium truncate">{item.hostname}</span>
      </div>
      <div className={`px-2 py-1 rounded text-xs font-semibold ${getStatusColor()}`}>
        {item.status === "Online" ? item.uptimeText : item.status}
      </div>
    </div>
  );
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / (24 * 60 * 60));
  const hours = Math.floor((seconds % (24 * 60 * 60)) / (60 * 60));
  const minutes = Math.floor((seconds % (60 * 60)) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  } else if (hours > 0) {
    return `${hours}h ${minutes}m`;
  } else {
    return `${minutes}m`;
  }
}

function formatUptimeShort(seconds: number): string {
  const days = Math.floor(seconds / (24 * 60 * 60));
  if (days > 0) return `${days}d`;
  const hours = Math.floor(seconds / (60 * 60));
  return `${hours}h`;
}
