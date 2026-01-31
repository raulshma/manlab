import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchNodes } from "@/api";
import { Activity, Server, Cpu, HardDrive, AlertTriangle, MemoryStick, Thermometer } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";

export const FleetStatsWidget = memo(function FleetStatsWidget({ config }: WidgetProps) {
  const stats = (config.stats as string[]) || ["total", "online"];
  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
    refetchInterval: ((config.refreshInterval as number) || 30) * 1000,
  });

  const total = nodes?.length ?? 0;
  const online = nodes?.filter((n) => n.status === "Online").length ?? 0;
  const offline = nodes?.filter((n) => n.status === "Offline").length ?? 0;
  const avgCpu = 0;
  const avgRam = 0;
  const avgDisk = 0;
  const issues = offline + (nodes?.filter((n) => n.status === "Error").length ?? 0);

  const getStatValue = (statType: string): string => {
    switch (statType) {
      case "total":
        return total.toString();
      case "online":
        return online.toString();
      case "offline":
        return offline.toString();
      case "avgCpu":
        return `${avgCpu.toFixed(1)}%`;
      case "avgRam":
        return `${avgRam.toFixed(1)}%`;
      case "avgDisk":
        return `${avgDisk.toFixed(1)}%`;
      case "issues":
        return issues.toString();
      default:
        return "—";
    }
  };

  const getStatLabel = (statType: string): string => {
    switch (statType) {
      case "total":
        return "Total Nodes";
      case "online":
        return "Online";
      case "offline":
        return "Offline";
      case "avgCpu":
        return "Avg CPU";
      case "avgRam":
        return "Avg RAM";
      case "avgDisk":
        return "Avg Disk";
      case "issues":
        return "Issues";
      default:
        return statType;
    }
  };

  const getStatIcon = (statType: string): React.ElementType => {
    switch (statType) {
      case "total":
        return Server;
      case "online":
        return Activity;
      case "offline":
        return Server;
      case "avgCpu":
        return Cpu;
      case "avgRam":
        return MemoryStick;
      case "avgDisk":
        return HardDrive;
      case "issues":
        return AlertTriangle;
      default:
        return Activity;
    }
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {stats.map((statType) => {
          const Icon = getStatIcon(statType);
          const value = getStatValue(statType);
          const label = getStatLabel(statType);

          return (
            <div key={statType} className="space-y-1">
              <div className="flex items-center gap-2 text-muted-foreground/70">
                <Icon className="h-4 w-4" />
                <span className="text-sm font-medium">{label}</span>
              </div>
              <div className="text-3xl font-bold">
                {value}
              </div>
            </div>
          );
        })}
      </div>
      {stats.includes("avgCpu") && (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-muted-foreground/70">
                <Thermometer className="h-4 w-4" />
                <span className="text-sm font-medium">Avg Temp</span>
              </div>
          <div className="text-3xl font-bold">
                —
              </div>
        </div>
      )}
    </div>
  );
});
