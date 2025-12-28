import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { MachineOnboardingModal } from "@/components/MachineOnboardingModal";
import { LocalAgentCard } from "@/components/LocalAgentCard";
import { NodeGrid } from "@/components/NodeGrid";
import { fetchNodes } from "@/api";
import { Laptop, Server, WifiOff, type LucideIcon } from "lucide-react";

function StatsItem({
  label,
  value,
  icon: Icon,
  trend,
}: {
  label: string;
  value: number;
  icon: LucideIcon;
  trend?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-2">
        <span className="text-2xl font-semibold tracking-tight">{value}</span>
        {trend && <span className="text-xs text-muted-foreground">{trend}</span>}
      </div>
    </div>
  );
}

function StatsCards() {
  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
  });

  const totalNodes = nodes?.length ?? 0;
  const onlineNodes = nodes?.filter((n) => n.status === "Online").length ?? 0;
  const offlineNodes = nodes?.filter((n) => n.status === "Offline").length ?? 0;

  return (
    <div className="flex w-full flex-col gap-6 sm:flex-row sm:items-center sm:gap-10 border-b pb-6">
      <StatsItem label="Total Nodes" value={totalNodes} icon={Server} />
      <div className="hidden h-10 w-px bg-border sm:block" />
      <StatsItem label="Online" value={onlineNodes} icon={Laptop} />
      <div className="hidden h-10 w-px bg-border sm:block" />
      <StatsItem label="Offline" value={offlineNodes} icon={WifiOff} />
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();

  return (
    <div className="mx-auto max-w-6xl space-y-8 p-6">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Overview of your infrastructure
          </p>
        </div>
        <MachineOnboardingModal
          trigger={<Button size="sm">Onboard machine</Button>}
        />
      </header>

      <StatsCards />

      <section className="space-y-4">
        {/* We keep LocalAgentCard as is for now, or wrap it minimally if needed. 
            It is quite heavy, so maybe we put it in a separate tab or below? 
            For now, let's keep it but slightly separated. */}
        <LocalAgentCard />
      </section>

      <section className="space-y-4 pt-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Registered Nodes</h2>
        </div>
        
        {/* Removed the Card wrapper for a cleaner grid directly on the background */}
        <NodeGrid onSelectNode={(nodeId) => navigate(`/nodes/${nodeId}`)} />
      </section>
    </div>
  );
}
