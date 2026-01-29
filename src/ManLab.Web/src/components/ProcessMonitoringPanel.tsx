import { memo, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Cpu, MemoryStick, AlertTriangle, Activity } from "lucide-react";
import type { ProcessTelemetry, ProcessAlert } from "@/types";

interface ProcessMonitoringPanelProps {
  processes: ProcessTelemetry[];
  alerts?: ProcessAlert[];
  isLoading?: boolean;
  maxItems?: number;
  showNodeName?: boolean;
  nodeName?: string;
}

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

export const ProcessMonitoringPanel = memo(function ProcessMonitoringPanel({
  processes,
  alerts = [],
  isLoading = false,
  maxItems = 5,
  showNodeName = false,
  nodeName,
}: ProcessMonitoringPanelProps) {
  // Memoize expensive computations
  const { topCpu, topMemory, alertMap } = useMemo(() => {
    if (!processes || processes.length === 0) {
      return { topCpu: [], topMemory: [], alertMap: new Map() };
    }

    // Sort by CPU and get top processes
    const topCpuSorted = [...processes]
      .filter((p) => p.cpuPercent !== null)
      .sort((a, b) => (b.cpuPercent ?? 0) - (a.cpuPercent ?? 0))
      .slice(0, maxItems);

    // Sort by memory and get top processes
    const topMemorySorted = [...processes]
      .filter((p) => p.memoryBytes !== null)
      .sort((a, b) => (b.memoryBytes ?? 0) - (a.memoryBytes ?? 0))
      .slice(0, maxItems);

    // Create a map of process IDs to alerts for quick lookup
    const map = new Map<string, ProcessAlert>();
    for (const alert of alerts) {
      const key = `${alert.processId}-${alert.alertType}`;
      map.set(key, alert);
    }

    return { topCpu: topCpuSorted, topMemory: topMemorySorted, alertMap: map };
  }, [processes, alerts, maxItems]);

  // Memoize alert badge display
  const alertBadge = useMemo(() => {
    if (alerts.length === 0) return null;
    return (
      <Badge variant="destructive" className="ml-auto text-xs">
        <AlertTriangle className="w-3 h-3 mr-1" />
        {alerts.length} Alert{alerts.length > 1 ? 's' : ''}
      </Badge>
    );
  }, [alerts.length]);

  if (isLoading) {
    return (
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-medium flex items-center gap-2">
            <Activity className="w-4 h-4 text-muted-foreground" />
            Top Processes
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground">Loading...</div>
        </CardContent>
      </Card>
    );
  }

  if (!processes || processes.length === 0) {
    return null;
  }

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          Top Processes
          {alertBadge}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Top CPU */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Cpu className="w-3.5 h-3.5" />
              Top {maxItems} by CPU
            </div>
            <div className="space-y-1.5">
              {topCpu.map((process) => {
                const cpuAlert = alertMap.get(`${process.processId}-Cpu`);
                return (
                  <div
                    key={process.processId}
                    className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-medium truncate" title={process.processName ?? undefined}>
                        {process.processName ?? 'Unknown'}
                      </span>
                      {showNodeName && nodeName && (
                        <span className="text-xs text-muted-foreground truncate">
                          ({nodeName})
                        </span>
                      )}
                      {cpuAlert && (
                        <Badge variant="destructive" className="text-xs ml-auto">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Alert
                        </Badge>
                      )}
                    </div>
                    <span className="tabular-nums ml-2">
                      {formatPercent(process.cpuPercent)}
                    </span>
                  </div>
                );
              })}
              {topCpu.length === 0 && (
                <div className="text-sm text-muted-foreground italic">No CPU data</div>
              )}
            </div>
          </div>

          {/* Top Memory */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MemoryStick className="w-3.5 h-3.5" />
              Top {maxItems} by Memory
            </div>
            <div className="space-y-1.5">
              {topMemory.map((process) => {
                const memAlert = alertMap.get(`${process.processId}-Memory`);
                return (
                  <div
                    key={process.processId}
                    className="flex items-center justify-between text-sm py-1 px-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <span className="font-medium truncate" title={process.processName ?? undefined}>
                        {process.processName ?? 'Unknown'}
                      </span>
                      {showNodeName && nodeName && (
                        <span className="text-xs text-muted-foreground truncate">
                          ({nodeName})
                        </span>
                      )}
                      {memAlert && (
                        <Badge variant="destructive" className="text-xs ml-auto">
                          <AlertTriangle className="w-3 h-3 mr-1" />
                          Alert
                        </Badge>
                      )}
                    </div>
                    <span className="tabular-nums ml-2">
                      {formatBytes(process.memoryBytes)}
                    </span>
                  </div>
                );
              })}
              {topMemory.length === 0 && (
                <div className="text-sm text-muted-foreground italic">No memory data</div>
              )}
            </div>
          </div>
        </div>

        {alerts.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <div className="text-sm font-medium text-muted-foreground mb-2">Active Alerts</div>
            <div className="space-y-2">
              {alerts.slice(0, 3).map((alert) => (
                <div key={`${alert.processId}-${alert.alertType}`} className="flex items-start gap-2 text-sm p-2 rounded bg-destructive/10 border border-destructive/20">
                  <AlertTriangle className="w-4 h-4 text-destructive mt-0.5 flex-shrink-0" />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">
                      {alert.processName} (PID: {alert.processId})
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {alert.alertType} {alert.currentValue.toFixed(1)}% exceeds threshold {alert.threshold}%
                    </div>
                  </div>
                </div>
              ))}
              {alerts.length > 3 && (
                <div className="text-xs text-muted-foreground text-center">
                  +{alerts.length - 3} more alert{alerts.length - 3 > 1 ? 's' : ''}
                </div>
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
});
