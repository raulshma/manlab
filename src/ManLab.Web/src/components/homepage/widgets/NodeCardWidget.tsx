import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, HardDrive, MemoryStick, Server, Activity } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { Node as NodeDto } from "@/types";
import { fetchNodes, fetchNode, fetchNodeTelemetry } from "@/api";

export const NodeCardWidget = memo(function NodeCardWidget({ config }: WidgetProps) {
  const nodeId = (config.nodeId as string) || "";

  const { data: node } = useQuery({
    queryKey: ["node", nodeId],
    queryFn: async () => {
      if (nodeId === "auto") {
        return fetchNodes(); // Return Node[] as any to satisfy type? No, queryFn should return specific type.
        // fetchNodes returns Node[].
        // But if nodeId is specific, we return Node.
        // The usage later checks Array.isArray or implicit?
      }
      return fetchNode(nodeId);
    },
    enabled: !!nodeId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const { data: telemetryData } = useQuery({
    queryKey: ["nodeTelemetry", nodeId],
    queryFn: () => {
      if (nodeId && nodeId !== "auto") {
        return fetchNodeTelemetry(nodeId, 5);
      }
      return Promise.resolve(null);
    },
    enabled: !!nodeId && nodeId !== "auto",
    staleTime: 30_000,
  });

  // Handle telemetry being array
  const telemetry = Array.isArray(telemetryData) ? telemetryData[0] : null;

  const compactMode = (config.compactMode as boolean) ?? false;

  if (!node && !nodeId || nodeId === "auto") {
    // If auto, we expect node to be Node[]
    if (nodeId === "auto" && Array.isArray(node)) {
        const nodes = node as NodeDto[];
        return (
          <div className="space-y-3">
            {nodes.slice(0, 6).map((n) => (
              <MiniNodeCard key={n.id} node={n} compactMode={compactMode} />
            ))}
          </div>
        );
    }

    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <Server className="h-4 w-4" />
          <span className="text-sm">Select a node or configure to show all nodes</span>
        </div>
      </div>
    );
  }

  // Cast node to NodeDto (single)
  const singleNode = node as NodeDto;
  const isOnline = singleNode?.status === "Online";
  const statusColor = isOnline ? "text-green-500" : "text-red-500";
  const statusBg = isOnline ? "bg-green-500/10" : "bg-red-500/10";

  return (
    <Card className="border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">{singleNode?.hostname || "Node"}</CardTitle>
            <div className="flex items-center gap-2">
              <div className={`flex items-center gap-1 px-2 py-1 rounded ${statusBg}`}>
                <Activity className={`h-4 w-4 ${isOnline ? "text-green-500" : "text-red-500"}`} />
                <span className={`text-xs font-medium ${isOnline ? "text-green-500" : statusColor}`}>
                  {singleNode?.status || "Unknown"}
                </span>
              </div>
              <div className="text-xs text-muted-foreground/70">
                {singleNode?.os || "Unknown OS"}
              </div>
            </div>
            {nodeId && (
              <a
                href={`/nodes/${nodeId}`}
                className="text-xs text-primary hover:underline"
              >
                View Details →
              </a>
            )}
          </div>
          <div className="text-xs text-muted-foreground/60">
            {singleNode?.lastSeen && `Last seen: ${new Date(singleNode.lastSeen).toLocaleString()}`}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        {telemetry ? (
          <>
            {compactMode ? (
              <div className="grid grid-cols-3 gap-4">
                <StatCard
                  icon={<Cpu className="h-5 w-5 text-blue-500" />}
                  label="CPU"
                  value={`${telemetry.cpuUsage ?? 0}%`}
                  color="blue"
                />
                <StatCard
                  icon={<MemoryStick className="h-5 w-5 text-purple-500" />}
                  label="RAM"
                  value={`${telemetry.ramUsage ?? 0}%`}
                  color="purple"
                />
                <StatCard
                  icon={<HardDrive className="h-5 w-5 text-green-500" />}
                  label="Disk"
                  value={`${telemetry.diskUsage ?? 0}%`}
                  color="green"
                />
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-muted-foreground/70">Resource Usage</h3>
                  <span className="text-xs text-muted-foreground/50">
                    {telemetry.timestamp && `Updated: ${new Date(telemetry.timestamp).toLocaleString()}`}
                  </span>
                </div>
                <ProgressBar
                  label="CPU"
                  value={telemetry.cpuUsage ?? 0}
                  max={100}
                  color="blue"
                />
                <ProgressBar
                  label="RAM"
                  value={telemetry.ramUsage ?? 0}
                  max={100}
                  color="purple"
                />
                <div className="grid grid-cols-1 gap-4 mt-4">
                     <div className="space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="text-sm font-medium text-muted-foreground/70">Disk</h3>
                        <span className="text-xs text-muted-foreground/50">
                          {telemetry.diskUsage}% used
                        </span>
                      </div>
                      <ProgressBar
                        label="Disk"
                        value={telemetry.diskUsage ?? 0}
                        max={100}
                        color="green"
                      />
                    </div>
                </div>
              </div>
            )}
          </>
        ) : (
          <div className="flex items-center justify-center py-8">
            <Activity className="h-6 w-6 text-muted-foreground/50 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground/70">Loading...</span>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

function MiniNodeCard({ node, compactMode }: { node: NodeDto; compactMode: boolean }) {
  const isOnline = node.status === "Online";
  const statusColor = isOnline ? "text-green-500" : "text-red-500";
  const statusBg = isOnline ? "bg-green-500/10" : "bg-red-500/10";

  if (compactMode) {
    return (
      <div className={`p-3 bg-card border rounded-lg hover:shadow-md transition-all ${isOnline ? "hover:border-green-500/50" : "hover:border-red-500/50"}`}>
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-1 px-2 py-1 rounded ${statusBg}`}>
              <Activity className={`h-4 w-4 ${isOnline ? "text-green-500" : "text-red-500"}`} />
              <span className={`text-xs font-medium ${isOnline ? "text-green-500" : statusColor}`}>
                {node.status}
              </span>
            </div>
          </div>
        </div>
        <div className="space-y-1">
          <div className="text-sm font-semibold text-foreground">{node.hostname}</div>
          <div className="text-xs text-muted-foreground/70">{node.os}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={`p-4 bg-card border rounded-lg hover:shadow-md transition-all ${isOnline ? "hover:border-green-500/50" : "hover:border-red-500/50"}`}>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className={`flex items-center gap-1 px-2 py-1 rounded ${statusBg}`}>
            <Activity className={`h-4 w-4 ${isOnline ? "text-green-500" : "text-red-500"}`} />
            <span className={`text-xs font-medium ${isOnline ? "text-green-500" : statusColor}`}>
              {node.status}
            </span>
          </div>
        </div>
        <div className="text-xs text-muted-foreground/60">
          {node.lastSeen && `Last seen: ${new Date(node.lastSeen).toLocaleString()}`}
        </div>
      </div>
      <div className="space-y-1">
        <div className="text-base font-semibold text-foreground">{node.hostname}</div>
        <div className="text-sm text-muted-foreground/70">{node.os}</div>
        {node.version && (
          <div className="text-xs text-muted-foreground/50">Version: {node.version}</div>
        )}
      </div>
      <a
        href={`/nodes/${node.id}`}
        className="mt-3 inline-block text-xs text-primary hover:underline"
      >
        View Details →
      </a>
    </div>
  );
}

function StatCard({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <div className={`p-2 rounded bg-${color}-500/10`}>
          {icon}
        </div>
        <div className="flex-1">
          <div className="text-xs text-muted-foreground/70 mb-0.5">{label}</div>
          <div className="text-lg font-bold">{value}</div>
        </div>
      </div>
    </div>
  );
}

function ProgressBar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  const percentage = Math.min(Math.max((value / max) * 100, 0), 100);

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground/70">{label}</span>
          <span className={`text-xs font-semibold text-${color}-500 ml-2`}>
            {percentage.toFixed(1)}%
          </span>
        </div>
        <div className="flex-1 h-2 bg-muted/30 rounded-full overflow-hidden">
          <div
            className={`h-full bg-${color}-500 rounded-full transition-all duration-500`}
            style={{ width: `${percentage}%` }}
          />
        </div>
      </div>
    </div>
  );
}
