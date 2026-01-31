import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { HardDrive, Thermometer, Activity, AlertTriangle, CheckCircle } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { SmartDriveSnapshot } from "@/types";
import { fetchNodes, fetchSmartHistory } from "@/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const DiskHealthWidget = memo(function DiskHealthWidget({ config, onConfigChange }: WidgetProps) {
  const nodeId = (config.nodeId as string) || "";
  const showAllDrives = (config.showAllDrives as boolean) ?? true;

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
  });

  const { data: smartData, isLoading } = useQuery({
    queryKey: ["smartHistory", nodeId],
    queryFn: () => {
      if (!nodeId) return Promise.resolve(null);
      return fetchSmartHistory(nodeId, 50);
    },
    enabled: !!nodeId,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const selectedNode = nodes?.find((n) => n.id === nodeId);
  const hasSmartCapability = selectedNode?.capabilities?.tools?.smartctl ?? false;

  if (!nodeId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <HardDrive className="h-4 w-4" />
          <span className="text-sm">Select a node to monitor disk health</span>
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
            <HardDrive className="h-5 w-5 text-amber-500" />
            Disk Health
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

  if (!hasSmartCapability) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-amber-500" />
            Disk Health
          </CardTitle>
          {selectedNode && (
            <div className="text-sm text-muted-foreground/70">
              {selectedNode.hostname}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/70 space-y-2">
            <HardDrive className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm">SMART monitoring not available</p>
            <p className="text-xs text-muted-foreground/50">smartctl is not installed on this node</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!smartData || smartData.length === 0) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <HardDrive className="h-5 w-5 text-amber-500" />
            Disk Health
          </CardTitle>
          {selectedNode && (
            <div className="text-sm text-muted-foreground/70">
              {selectedNode.hostname}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-8 text-muted-foreground/70">
            <HardDrive className="h-12 w-12 text-muted-foreground/30" />
            <p className="ml-2 text-sm">No SMART data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // Get unique drives (latest snapshot for each)
  const drivesMap = new Map<string, SmartDriveSnapshot>();
  smartData.forEach((snapshot) => {
    const existing = drivesMap.get(snapshot.device);
    if (!existing || new Date(snapshot.timestamp) > new Date(existing.timestamp)) {
      drivesMap.set(snapshot.device, snapshot);
    }
  });

  const drives = Array.from(drivesMap.values());
  const drivesToShow = showAllDrives ? drives : drives.slice(0, 1);

  const warningCount = drives.filter((d) => d.health !== "PASSED").length;

  return (
    <Card className="border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <HardDrive className="h-5 w-5 text-amber-500" />
              Disk Health
            </CardTitle>
            {selectedNode && (
              <div className="text-sm text-muted-foreground/70">
                {selectedNode.hostname} • {drives.length} drives
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {warningCount > 0 ? (
              <div className="flex items-center gap-1 px-2 py-1 bg-red-500/10 rounded text-xs text-red-600">
                <AlertTriangle className="h-3 w-3" />
                <span>{warningCount} warning</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded text-xs text-green-600">
                <CheckCircle className="h-3 w-3" />
                <span>All healthy</span>
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4 space-y-3">
        {drivesToShow.map((drive) => (
          <DriveCard key={drive.device} drive={drive} />
        ))}
      </CardContent>
    </Card>
  );
});

function DriveCard({ drive }: { drive: SmartDriveSnapshot }) {
  const isHealthy = drive.health === "PASSED";
  const temperature = drive.temperatureC ?? 0;
  const powerOnHours = drive.powerOnHours ?? 0;
  const powerOnDays = Math.floor(powerOnHours / 24);

  const getTempColor = (temp: number): string => {
    if (temp < 40) return "text-green-500";
    if (temp < 50) return "text-yellow-500";
    return "text-red-500";
  };

  const getHealthBadge = (health: string) => {
    if (health === "PASSED") {
      return (
        <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 rounded text-xs text-green-600">
          <CheckCircle className="h-3 w-3" />
          Healthy
        </div>
      );
    }
    return (
      <div className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 rounded text-xs text-red-600">
        <AlertTriangle className="h-3 w-3" />
        {health}
      </div>
    );
  };

  return (
    <div className={`p-3 rounded-lg space-y-2 ${isHealthy ? 'bg-muted/20' : 'bg-red-500/5 border border-red-500/20'}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className={`h-4 w-4 ${isHealthy ? 'text-amber-500' : 'text-red-500'}`} />
          <span className="text-sm font-medium font-mono">{drive.device}</span>
        </div>
        {getHealthBadge(drive.health || "UNKNOWN")}
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-1 text-muted-foreground/70">
            <Thermometer className="h-3 w-3" />
            Temp
          </div>
          <div className={`font-medium ${getTempColor(temperature)}`}>
            {temperature > 0 ? `${temperature}°C` : "N/A"}
          </div>
        </div>

        <div className="space-y-1">
          <div className="text-muted-foreground/70">Power On</div>
          <div className="font-medium">
            {powerOnDays > 0 ? `${powerOnDays}d` : `${powerOnHours}h`}
          </div>
        </div>
      </div>
    </div>
  );
}
