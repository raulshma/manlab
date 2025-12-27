import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Server } from "lucide-react";
import { MachineOnboardingModal } from "@/components/MachineOnboardingModal";
import { NodeCard } from "@/components/NodeCard";
import { fetchNodes } from "@/api";
import type { Node, NodeStatus } from "@/types";

function StatusPill({ status }: { status: NodeStatus | "All" }) {
  if (status === "All") return <Badge variant="outline">All</Badge>;
  if (status === "Online") return <Badge>Online</Badge>;
  if (status === "Offline") return <Badge variant="destructive">Offline</Badge>;
  return <Badge variant="secondary">Maintenance</Badge>;
}

export function NodesPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<NodeStatus | "All">("All");

  const {
    data: nodes,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = nodes ?? [];

    return base
      .filter((n) => (status === "All" ? true : n.status === status))
      .filter((n) => {
        if (!q) return true;
        return (
          n.hostname.toLowerCase().includes(q) ||
          (n.ipAddress ?? "").toLowerCase().includes(q) ||
          (n.os ?? "").toLowerCase().includes(q)
        );
      });
  }, [nodes, query, status]);

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <CardTitle>Nodes</CardTitle>
          <CardDescription>
            Browse and manage registered devices
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          <MachineOnboardingModal trigger={<Button>Onboard machine</Button>} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search hostname, IP, OS…"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={status === "All" ? "secondary" : "ghost"}
              onClick={() => setStatus("All")}
            >
              <StatusPill status="All" />
            </Button>
            <Button
              size="sm"
              variant={status === "Online" ? "secondary" : "ghost"}
              onClick={() => setStatus("Online")}
            >
              <StatusPill status="Online" />
            </Button>
            <Button
              size="sm"
              variant={status === "Offline" ? "secondary" : "ghost"}
              onClick={() => setStatus("Offline")}
            >
              <StatusPill status="Offline" />
            </Button>
            <Button
              size="sm"
              variant={status === "Maintenance" ? "secondary" : "ghost"}
              onClick={() => setStatus("Maintenance")}
            >
              <StatusPill status="Maintenance" />
            </Button>
          </div>
        </div>

        {isLoading && (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
            {[...Array(6)].map((_, i) => (
              <Card key={i}>
                <CardContent className="pt-6">
                  <div className="flex items-center gap-3 mb-4">
                    <Skeleton className="w-2.5 h-2.5 rounded-full" />
                    <Skeleton className="h-5 w-32" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-4 w-36" />
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Failed to load nodes</AlertTitle>
            <AlertDescription>
              {error instanceof Error
                ? error.message
                : "Unknown error occurred"}
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !isError && filtered.length === 0 && (
          <Card>
            <CardContent className="flex flex-col items-center justify-center py-12">
              <div className="w-16 h-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <Server className="w-8 h-8 text-muted-foreground" />
              </div>
              <h3 className="text-foreground font-medium mb-1">
                No nodes found
              </h3>
              <p className="text-muted-foreground text-sm">
                Try adjusting your search or filters
              </p>
            </CardContent>
          </Card>
        )}

        {!isLoading && !isError && filtered.length > 0 && (
          <div
            role="list"
            aria-label="Device nodes"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3"
          >
            {filtered.map((node: Node) => (
              <NodeCard
                key={node.id}
                node={node}
                onClick={() => navigate(`/nodes/${node.id}`)}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
