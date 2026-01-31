import { memo, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNodes, fetchServiceStatusHistory } from "@/api";
import { 
  CheckCircle2, 
  XCircle, 
  AlertCircle,
  Server,
  Settings,
  Activity
} from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { Node, ServiceStatusSnapshot } from "@/types";

interface ServiceStatusItem {
  nodeId: string;
  hostname: string;
  services: {
    name: string;
    status: "running" | "stopped" | "failed" | "unknown";
    lastChecked: string;
  }[];
  summary: {
    running: number;
    stopped: number;
    failed: number;
    total: number;
  };
}

export const ServiceStatusWidget = memo(function ServiceStatusWidget({ config }: WidgetProps) {
  const nodeId = (config.nodeId as string) || "auto";
  const showAllServices = (config.showAllServices as boolean) ?? false;
  const maxServices = (config.maxServices as number) || 5;

  const { data: nodes, isLoading: nodesLoading } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
  });

  const { data: serviceData, isLoading: servicesLoading } = useQuery({
    queryKey: ["serviceStatus", nodeId],
    queryFn: async () => {
      if (nodeId === "auto" || !nodeId) {
        // Fetch for all online nodes
        if (!nodes) return [];
        const onlineNodes = nodes.filter((n: Node) => n.status === "Online");
        const results = await Promise.all(
          onlineNodes.slice(0, 5).map(async (node: Node) => {
            try {
              const history = await fetchServiceStatusHistory(node.id, 1);
              return { nodeId: node.id, history: history[0] || null };
            } catch {
              return { nodeId: node.id, history: null };
            }
          })
        );
        return results;
      } else {
        const history = await fetchServiceStatusHistory(nodeId, 1);
        return [{ nodeId, history: history[0] || null }];
      }
    },
    enabled: !!nodes && (nodeId !== "auto" || nodes.length > 0),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const serviceItems: ServiceStatusItem[] = useMemo(() => {
    if (!nodes || !serviceData) return [];

    return serviceData
      .filter((data) => data.history !== null)
      .map((data) => {
        const node = nodes.find((n: Node) => n.id === data.nodeId);
        const snapshot = data.history as ServiceStatusSnapshot;
        
        const services = (snapshot?.services || [])
          .slice(0, showAllServices ? undefined : maxServices)
          .map((svc) => ({
            name: svc.name,
            status: svc.status.toLowerCase() as "running" | "stopped" | "failed" | "unknown",
            lastChecked: snapshot.timestampUtc,
          }));

        const summary = {
          running: services.filter((s) => s.status === "running").length,
          stopped: services.filter((s) => s.status === "stopped").length,
          failed: services.filter((s) => s.status === "failed").length,
          total: services.length,
        };

        return {
          nodeId: data.nodeId,
          hostname: node?.hostname || data.nodeId,
          services,
          summary,
        };
      });
  }, [nodes, serviceData, showAllServices, maxServices]);

  const overallSummary = useMemo(() => {
    const allServices = serviceItems.flatMap((item) => item.services);
    return {
      total: allServices.length,
      running: allServices.filter((s) => s.status === "running").length,
      stopped: allServices.filter((s) => s.status === "stopped").length,
      failed: allServices.filter((s) => s.status === "failed").length,
    };
  }, [serviceItems]);

  if (nodesLoading || servicesLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary" />
      </div>
    );
  }

  if (serviceItems.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center space-y-3">
        <div className="p-3 bg-muted/20 rounded-full">
          <Settings className="h-8 w-8 text-muted-foreground" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">No Service Data</p>
          <p className="text-xs text-muted-foreground/70">
            Configure service monitoring to see status
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 h-full overflow-y-auto">
      {/* Overall Summary */}
      <div className="grid grid-cols-3 gap-2 pb-2 border-b border-border/30">
        <div className="p-2 bg-green-500/10 rounded-lg text-center">
          <div className="text-xl font-bold text-green-600">{overallSummary.running}</div>
          <div className="text-xs text-green-600/70">Running</div>
        </div>
        <div className="p-2 bg-amber-500/10 rounded-lg text-center">
          <div className="text-xl font-bold text-amber-600">{overallSummary.stopped}</div>
          <div className="text-xs text-amber-600/70">Stopped</div>
        </div>
        <div className="p-2 bg-red-500/10 rounded-lg text-center">
          <div className="text-xl font-bold text-red-600">{overallSummary.failed}</div>
          <div className="text-xs text-red-600/70">Failed</div>
        </div>
      </div>

      {/* Service List by Node */}
      <div className="space-y-3">
        {serviceItems.map((item) => (
          <div key={item.nodeId} className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-semibold">{item.hostname}</span>
              </div>
              <div className="flex items-center gap-2">
                {item.summary.failed > 0 && (
                  <span className="text-xs px-2 py-0.5 bg-red-500/10 text-red-600 rounded">
                    {item.summary.failed} failed
                  </span>
                )}
                <span className="text-xs text-muted-foreground">
                  {item.summary.running}/{item.summary.total}
                </span>
              </div>
            </div>
            
            <div className="space-y-1 pl-6">
              {item.services.map((service) => (
                <ServiceRow key={`${item.nodeId}-${service.name}`} service={service} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});

function ServiceRow({ service }: { service: { name: string; status: string; lastChecked: string } }) {
  const getIcon = () => {
    switch (service.status) {
      case "running":
        return <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />;
      case "stopped":
        return <AlertCircle className="h-3.5 w-3.5 text-amber-500" />;
      case "failed":
        return <XCircle className="h-3.5 w-3.5 text-red-500" />;
      default:
        return <Activity className="h-3.5 w-3.5 text-gray-400" />;
    }
  };

  const getStatusClass = () => {
    switch (service.status) {
      case "running":
        return "text-green-600";
      case "stopped":
        return "text-amber-600";
      case "failed":
        return "text-red-600";
      default:
        return "text-gray-400";
    }
  };

  return (
    <div className="flex items-center justify-between py-1 px-2 rounded hover:bg-muted/30 transition-colors">
      <div className="flex items-center gap-2">
        {getIcon()}
        <span className="text-xs truncate">{service.name}</span>
      </div>
      <span className={`text-xs font-medium capitalize ${getStatusClass()}`}>
        {service.status}
      </span>
    </div>
  );
}
