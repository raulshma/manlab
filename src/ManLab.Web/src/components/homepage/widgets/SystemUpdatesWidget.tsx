import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { fetchPendingUpdates } from "@/api";
import { RefreshCw, AlertTriangle, Calendar, Download } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";

export const SystemUpdatesWidget = memo(function SystemUpdatesWidget({ config, onConfigChange }: WidgetProps) {
  const showAllNodes = (config.showAllNodes as boolean) ?? false;
  const criticalOnly = (config.criticalOnly as boolean) ?? false;

  const { data: pendingData, isLoading } = useQuery({
    queryKey: ["pendingUpdates"],
    queryFn: fetchPendingUpdates,
    staleTime: 60_000,
    refetchInterval: 120_000,
  });

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const apiRef = pendingData as any;
  const totalCount = (apiRef?.agentUpdates?.length ?? 0) + (apiRef?.systemUpdates?.length ?? 0);

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <RefreshCw className="h-4 w-4 animate-spin" />
          <span className="text-sm">Loading updates...</span>
        </div>
      </div>
    );
  }

  if (!pendingData) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <AlertTriangle className="h-4 w-4" />
          <span className="text-sm">No pending updates data available</span>
        </div>
      </div>
    );
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const apiData = pendingData as any;
  // Map API response (agentUpdates, systemUpdates) to component structure (nodeUpdates, systemUpdates)
  // And map properties to match what the component expects
  const rawNodeUpdates = apiData?.agentUpdates || [];
  const rawSystemUpdates = apiData?.systemUpdates || [];

  const nodeUpdates = rawNodeUpdates.map((u: any) => ({
    id: u.nodeId,
    hostname: u.hostname,
    updatesCount: 1, // Agent update is single package
    priority: "Normal", // Default as not in API
    packageType: "Agent",
    ...u
  }));

  const systemUpdates = rawSystemUpdates.map((u: any) => ({
    id: u.updateId,
    label: u.updateType, // Component uses updateType for display?
    updatesCount: u.packageCount,
    priority: "Normal",
    updateType: u.updateType,
    ...u
  }));

  const filteredNodeUpdates = criticalOnly
    ? nodeUpdates.filter((u: any) => u.priority === "Critical" || u.priority === "High")
    : nodeUpdates;

  const filteredSystemUpdates = criticalOnly
    ? systemUpdates.filter((u: any) => u.priority === "Critical" || u.priority === "High")
    : systemUpdates;

  const displayNodeUpdates = showAllNodes ? filteredNodeUpdates : [];
  const displaySystemUpdates = showAllNodes ? filteredSystemUpdates : [];

  const nodeUpdateCount = displayNodeUpdates.length;
  const systemUpdateCount = displaySystemUpdates.length;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">Pending Updates</h3>
        <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
          <Download className="h-4 w-4" />
          <span>
            {totalCount} total update{totalCount === 1 ? "" : "s"}
          </span>
          {showAllNodes ? "• Showing all" : `• ${criticalOnly ? "Critical" : "All"} only`}
        </div>
      </div>

      {nodeUpdates.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-orange-500" />
              <h4 className="font-medium">Node Updates</h4>
            </div>
            {!showAllNodes && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  onConfigChange({ ...config, showAllNodes: true });
                }}
              >
                Show All
              </Button>
            )}
          </div>

          {displayNodeUpdates.slice(0, showAllNodes ? nodeUpdates.length : 3).map((update: any) => (
            <div key={update.id} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex-shrink-0">
                <Calendar className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{update.hostname}</span>
                    {update.priority === "Critical" && (
                      <span className="ml-auto px-2 py-0.5 bg-red-500 text-white text-xs font-medium rounded">Critical</span>
                    )}
                    {update.priority === "High" && (
                      <span className="ml-auto px-2 py-0.5 bg-orange-500 text-white text-xs font-medium rounded">High</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground/60">
                    {update.packageType || "System"}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground/80">
                  {update.updatesCount > 1
                    ? `${update.updatesCount} updates`
                    : "1 update"}
                </div>
              </div>
            </div>
          ))}
          {nodeUpdateCount > 0 && !showAllNodes && nodeUpdateCount > (showAllNodes ? 3 : 0) && (
            <div className="text-center py-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                   onConfigChange({ ...config, showAllNodes: true });
                }}
              >
                View All {nodeUpdateCount} Updates
              </Button>
            </div>
          )}
        </>
      )}

      {systemUpdates.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-blue-500" />
              <h4 className="font-medium">System Updates</h4>
            </div>
            {!showAllNodes && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                   onConfigChange({ ...config, showAllNodes: true });
                }}
              >
                Show All
              </Button>
            )}
          </div>

          {displaySystemUpdates.slice(0, showAllNodes ? systemUpdates.length : 3).map((update: any) => (
            <div key={update.id} className="flex items-start gap-3 p-3 bg-muted/30 rounded-lg hover:bg-muted/50 transition-colors">
              <div className="flex-shrink-0">
                <RefreshCw className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">ManLab Server</span>
                    {update.priority === "Critical" && (
                      <span className="ml-auto px-2 py-0.5 bg-red-500 text-white text-xs font-medium rounded">Critical</span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground/60">
                    {update.updateType || "System Update"}
                  </div>
                </div>
                <div className="text-sm text-muted-foreground/80">
                  {update.updatesCount} update{update.updatesCount === 1 ? "" : "s"}
                </div>
              </div>
            </div>
          ))}
          {systemUpdateCount > 0 && !showAllNodes && systemUpdateCount > (showAllNodes ? 3 : 0) && (
            <div className="text-center py-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                   onConfigChange({ ...config, showAllNodes: true });
                }}
              >
                View All {systemUpdateCount} Updates
              </Button>
            </div>
          )}
        </>
      )}

      {!showAllNodes && (
        <div className="text-center py-4 text-sm text-muted-foreground/70">
          {nodeUpdateCount === 0 && systemUpdateCount === 0 && (
            <>
              <AlertTriangle className="h-8 w-8 text-yellow-500 mx-auto mb-2" />
              <p className="font-medium">No pending updates</p>
              <p className="text-sm text-muted-foreground/70">Your fleet is up to date!</p>
            </>
           )}
        </div>
      )}
    </div>
  );
});
