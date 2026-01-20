import { useQuery } from "@tanstack/react-query";
import {
  fetchNodeTelemetry,
  fetchNodeNetworkTelemetry,
  fetchNodePingTelemetry,
  fetchSmartHistory,
  fetchGpuHistory,
  fetchUpsHistory,
  fetchAgentResourceUsage,
  fetchEnhancedNetworkTelemetry,
  fetchEnhancedGpuTelemetry,
  fetchApmTelemetry,
} from "../../api";
import { TelemetryChart } from "../TelemetryChart";
import { NetworkThroughputChart } from "../NetworkThroughputChart";
import { PingLatencyChart } from "../PingLatencyChart";
import { SmartDrivePanel } from "../SmartDrivePanel";
import { GpuStatsPanel } from "../GpuStatsPanel";
import { UpsStatusPanel } from "../UpsStatusPanel";
import { AgentResourceUsagePanel } from "../AgentResourceUsagePanel";
import { EnhancedNetworkPanel } from "../EnhancedNetworkPanel";
import { EnhancedGpuPanel } from "../EnhancedGpuPanel";
import { ApmPanel } from "../ApmPanel";

interface NodeHealthTabProps {
  nodeId: string;
}

export function NodeHealthTab({ nodeId }: NodeHealthTabProps) {
  // Fetch telemetry history
  const { data: telemetry } = useQuery({
    queryKey: ["telemetry", nodeId],
    queryFn: () => fetchNodeTelemetry(nodeId, 30),
    refetchInterval: 10000,
  });

  // Fetch network telemetry history
  const { data: networkTelemetry } = useQuery({
    queryKey: ["networkTelemetry", nodeId],
    queryFn: () => fetchNodeNetworkTelemetry(nodeId, 60),
    refetchInterval: 10000,
  });

  // Fetch ping telemetry history
  const { data: pingTelemetry } = useQuery({
    queryKey: ["pingTelemetry", nodeId],
    queryFn: () => fetchNodePingTelemetry(nodeId, 60),
    refetchInterval: 10000,
  });

  // Fetch SMART drive history
  const { data: smartData } = useQuery({
    queryKey: ["smartData", nodeId],
    queryFn: () => fetchSmartHistory(nodeId, 50),
    refetchInterval: 60000,
  });

  // Fetch GPU history
  const { data: gpuData } = useQuery({
    queryKey: ["gpuData", nodeId],
    queryFn: () => fetchGpuHistory(nodeId, 50),
    refetchInterval: 10000,
  });

  // Fetch UPS history
  const { data: upsData } = useQuery({
    queryKey: ["upsData", nodeId],
    queryFn: () => fetchUpsHistory(nodeId, 50),
    refetchInterval: 10000,
  });

  // Fetch agent resource usage
  const { data: agentResourceUsage } = useQuery({
    queryKey: ["agentResourceUsage", nodeId],
    queryFn: () => fetchAgentResourceUsage(nodeId, 60),
    refetchInterval: 10000,
  });

  // Fetch enhanced network telemetry
  const { data: enhancedNetwork } = useQuery({
    queryKey: ["enhancedNetwork", nodeId],
    queryFn: () => fetchEnhancedNetworkTelemetry(nodeId),
    refetchInterval: 10000,
  });

  // Fetch enhanced GPU telemetry
  const { data: enhancedGpu } = useQuery({
    queryKey: ["enhancedGpu", nodeId],
    queryFn: () => fetchEnhancedGpuTelemetry(nodeId),
    refetchInterval: 10000,
  });

  // Fetch APM telemetry
  const { data: apmData } = useQuery({
    queryKey: ["apmData", nodeId],
    queryFn: () => fetchApmTelemetry(nodeId),
    refetchInterval: 10000,
  });

  return (
    <div className="space-y-8 animate-in fade-in zoom-in-95 duration-200">
      {/* Telemetry Charts */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          System Telemetry
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <TelemetryChart
            data={telemetry || []}
            metric="cpuUsage"
            label="CPU Usage"
            color="hsl(var(--chart-1))"
            nodeId={nodeId}
          />
          <TelemetryChart
            data={telemetry || []}
            metric="ramUsage"
            label="RAM Usage"
            color="hsl(var(--chart-2))"
            nodeId={nodeId}
          />
          <TelemetryChart
            data={telemetry || []}
            metric="diskUsage"
            label="Disk Usage"
            color="hsl(var(--chart-3))"
            nodeId={nodeId}
          />
        </div>
      </section>

      {/* Network Monitoring */}
      <section>
        <h2 className="text-lg font-semibold text-foreground mb-4">
          Network
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <NetworkThroughputChart data={networkTelemetry || []} nodeId={nodeId} />
          <PingLatencyChart data={pingTelemetry || []} nodeId={nodeId} />
        </div>
      </section>

      {/* Agent Resource Usage */}
      {agentResourceUsage && agentResourceUsage.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Agent Process
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <AgentResourceUsagePanel data={agentResourceUsage} />
          </div>
        </section>
      )}

      {/* Enhanced Network Monitoring */}
      {enhancedNetwork && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Enhanced Network Monitoring
          </h2>
          <EnhancedNetworkPanel data={enhancedNetwork} />
        </section>
      )}

      {/* Enhanced GPU Monitoring */}
      {enhancedGpu && enhancedGpu.length > 0 && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Enhanced GPU Monitoring
          </h2>
          <EnhancedGpuPanel data={enhancedGpu} />
        </section>
      )}

      {/* Application Performance Monitoring */}
      {apmData && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Application Performance
          </h2>
          <ApmPanel data={apmData} />
        </section>
      )}

      {/* Hardware Health */}
      {((smartData && smartData.length > 0) ||
        (gpuData && gpuData.length > 0) ||
        (upsData && upsData.length > 0)) && (
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            Hardware Details
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <SmartDrivePanel data={smartData || []} />
            <GpuStatsPanel data={gpuData || []} />
            <UpsStatusPanel data={upsData || []} />
          </div>
        </section>
      )}
    </div>
  );
}
