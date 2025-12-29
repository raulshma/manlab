import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuSkeleton,
  SidebarInput,
  SidebarInset,
  SidebarGroup,
  SidebarGroupContent,
} from "@/components/ui/sidebar";
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Server, Globe, ChevronRight } from "lucide-react";
import { MachineOnboardingModal } from "@/components/MachineOnboardingModal";
import { NodeDetailView } from "@/components/NodeDetailView";
import { fetchNodes } from "@/api";
import type { Node, NodeStatus } from "@/types";

function StatusPill({ status }: { status: NodeStatus | "All" }) {
  if (status === "All") return <Badge variant="outline">All</Badge>;
  if (status === "Online") return <Badge>Online</Badge>;
  if (status === "Offline") return <Badge variant="destructive">Offline</Badge>;
  return <Badge variant="secondary">Maintenance</Badge>;
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

export function NodesPage() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<NodeStatus | "All">("All");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

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

  // Auto-select first node if none is selected
  const effectiveSelectedId =
    selectedNodeId && filtered.find((n) => n.id === selectedNodeId)
      ? selectedNodeId
      : filtered.length > 0
      ? filtered[0].id
      : null;

  return (
    <SidebarProvider
      defaultOpen={true}
      style={
        {
          "--sidebar-width": "320px",
        } as React.CSSProperties
      }
    >
      <Sidebar collapsible="none" className="border-r">
        {/* Sidebar Header with title, onboarding, filter */}
        <SidebarHeader>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold">Nodes</h2>
            <MachineOnboardingModal
              trigger={<Button size="sm">Onboard</Button>}
            />
          </div>

          <SidebarInput
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search nodes…"
          />

          <div className="flex flex-wrap items-center gap-1">
            {(["All", "Online", "Offline", "Maintenance"] as const).map((s) => (
              <Button
                key={s}
                size="sm"
                variant={status === s ? "secondary" : "ghost"}
                onClick={() => setStatus(s)}
                className="h-6 px-2 text-xs"
              >
                <StatusPill status={s} />
              </Button>
            ))}
          </div>
        </SidebarHeader>

        {/* Sidebar Content - Node List */}
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                {/* Loading Skeletons */}
                {isLoading &&
                  [...Array(5)].map((_, i) => (
                    <SidebarMenuItem key={i}>
                      <SidebarMenuSkeleton showIcon />
                    </SidebarMenuItem>
                  ))}

                {/* Error State */}
                {isError && (
                  <Alert variant="destructive" className="mx-2">
                    <AlertCircle className="h-4 w-4" />
                    <AlertTitle>Error</AlertTitle>
                    <AlertDescription>
                      {error instanceof Error
                        ? error.message
                        : "Failed to load nodes"}
                    </AlertDescription>
                  </Alert>
                )}

                {/* Empty State */}
                {!isLoading && !isError && filtered.length === 0 && (
                  <Empty className="py-8 border-0">
                    <EmptyMedia variant="icon">
                      <Server />
                    </EmptyMedia>
                    <EmptyTitle>No nodes found</EmptyTitle>
                    <EmptyDescription>
                      Try adjusting your search or filters
                    </EmptyDescription>
                  </Empty>
                )}

                {/* Node List */}
                {!isLoading &&
                  !isError &&
                  filtered.map((node: Node) => {
                    const isSelected = node.id === effectiveSelectedId;
                    const statusColor =
                      node.status === "Online"
                        ? "bg-green-500"
                        : node.status === "Offline"
                        ? "bg-red-500"
                        : node.status === "Maintenance"
                        ? "bg-yellow-500"
                        : "bg-muted";

                    return (
                      <SidebarMenuItem key={node.id}>
                        <SidebarMenuButton
                          isActive={isSelected}
                          onClick={() => setSelectedNodeId(node.id)}
                          className="h-auto py-2"
                        >
                          <div
                            className={`w-2 h-2 rounded-full flex-shrink-0 ${statusColor} ${
                              node.status === "Online"
                                ? "shadow-[0_0_6px_rgba(34,197,94,0.5)]"
                                : ""
                            }`}
                          />
                          <div className="flex-1 min-w-0 flex flex-col items-start">
                            <span className="font-medium text-sm truncate w-full">
                              {node.hostname}
                            </span>
                            {node.ipAddress && (
                              <span className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                                <Globe className="w-3 h-3" />
                                {node.ipAddress}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col items-end gap-0.5">
                            <span className="text-[10px] text-muted-foreground">
                              {formatRelativeTime(node.lastSeen)}
                            </span>
                            <ChevronRight
                              className={`w-4 h-4 transition-colors ${
                                isSelected
                                  ? "text-primary"
                                  : "text-muted-foreground/50"
                              }`}
                            />
                          </div>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    );
                  })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        {/* Sidebar Footer - Node Count */}
        {!isLoading && !isError && (
          <SidebarFooter>
            <div className="text-xs text-muted-foreground text-center border-t pt-2">
              {filtered.length} of {nodes?.length ?? 0} nodes
            </div>
          </SidebarFooter>
        )}
      </Sidebar>

      {/* Main Content - Node Details */}
      <SidebarInset>
        {effectiveSelectedId ? (
          <NodeDetailView
            nodeId={effectiveSelectedId}
            onBack={() => setSelectedNodeId(null)}
            showBackButton={false}
          />
        ) : (
          <Empty className="h-full border-0">
            <EmptyMedia variant="icon">
              <Server />
            </EmptyMedia>
            <EmptyTitle>Select a Node</EmptyTitle>
            <EmptyDescription>
              Choose a node from the sidebar to view its details, health, and
              workloads.
            </EmptyDescription>
          </Empty>
        )}
      </SidebarInset>
    </SidebarProvider>
  );
}
