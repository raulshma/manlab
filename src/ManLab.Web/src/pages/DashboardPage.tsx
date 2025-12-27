import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { MachineOnboardingModal } from "@/components/MachineOnboardingModal";
import { LocalAgentCard } from "@/components/LocalAgentCard";
import { NodeGrid } from "@/components/NodeGrid";
import { fetchNodes } from "@/api";

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
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="min-w-0">
            <CardDescription>Total nodes</CardDescription>
            <CardTitle>{totalNodes}</CardTitle>
          </div>
          <Badge variant="outline">Total</Badge>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="min-w-0">
            <CardDescription>Online</CardDescription>
            <CardTitle>{onlineNodes}</CardTitle>
          </div>
          <Badge>Online</Badge>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div className="min-w-0">
            <CardDescription>Offline</CardDescription>
            <CardTitle>{offlineNodes}</CardTitle>
          </div>
          <Badge variant="destructive">Offline</Badge>
        </CardHeader>
      </Card>
    </div>
  );
}

export function DashboardPage() {
  const navigate = useNavigate();

  return (
    <>
      <StatsCards />

      <LocalAgentCard />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div className="min-w-0">
            <CardTitle>Nodes</CardTitle>
            <CardDescription>
              Registered devices and their latest status
            </CardDescription>
          </div>
          <MachineOnboardingModal trigger={<Button>Onboard machine</Button>} />
        </CardHeader>
        <CardContent>
          <NodeGrid onSelectNode={(nodeId) => navigate(`/nodes/${nodeId}`)} />
        </CardContent>
      </Card>
    </>
  );
}
