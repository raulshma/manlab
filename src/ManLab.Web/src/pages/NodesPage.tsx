import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Empty,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from "@/components/ui/empty";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertCircle,
  Server,
  Globe,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
} from "lucide-react";
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

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
    <div className="flex h-[calc(100vh-5rem)] -m-4 -mb-8">
      {/* Sidebar Panel */}
      <div
        className={`flex flex-col border-r border-border bg-sidebar transition-all duration-200 ${
          sidebarCollapsed ? "w-12" : "w-80"
        }`}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-2 border-b border-border">
          {!sidebarCollapsed && (
            <>
              <h2 className="text-sm font-semibold px-2">Nodes</h2>
              <div className="flex items-center gap-1">
                <MachineOnboardingModal
                  trigger={
                    <Button size="sm" variant="ghost" className="h-7 text-xs">
                      Onboard
                    </Button>
                  }
                />
              </div>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          >
            {sidebarCollapsed ? (
              <PanelLeft className="h-4 w-4" />
            ) : (
              <PanelLeftClose className="h-4 w-4" />
            )}
          </Button>
        </div>

        {/* Filter Controls - hidden when collapsed */}
        {!sidebarCollapsed && (
          <div className="p-2 space-y-2 border-b border-border">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search nodes…"
              className="h-8 text-sm"
            />
            <div className="flex flex-wrap items-center gap-1">
              {(["All", "Online", "Offline", "Maintenance"] as const).map(
                (s) => (
                  <Button
                    key={s}
                    size="sm"
                    variant={status === s ? "secondary" : "ghost"}
                    onClick={() => setStatus(s)}
                    className="h-6 px-2 text-xs"
                  >
                    <StatusPill status={s} />
                  </Button>
                )
              )}
            </div>
          </div>
        )}

        {/* Node List */}
        <ScrollArea className="flex-1">
          <div className={sidebarCollapsed ? "p-1" : "p-2 space-y-1"}>
            {/* Loading Skeletons */}
            {isLoading &&
              [...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className={`rounded-md ${sidebarCollapsed ? "p-1" : "p-2"}`}
                >
                  {sidebarCollapsed ? (
                    <Skeleton className="w-8 h-8 rounded-md" />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Skeleton className="w-2 h-2 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-16" />
                      </div>
                    </div>
                  )}
                </div>
              ))}

            {/* Error State */}
            {isError && !sidebarCollapsed && (
              <Alert variant="destructive" className="mx-1">
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
            {!isLoading && !isError && filtered.length === 0 && !sidebarCollapsed && (
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

            {/* Node List Items */}
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

                if (sidebarCollapsed) {
                  // Collapsed view - just status indicator
                  return (
                    <button
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`w-full p-2 rounded-md transition-colors flex items-center justify-center ${
                        isSelected
                          ? "bg-accent"
                          : "hover:bg-accent/50"
                      }`}
                      title={node.hostname}
                    >
                      <div
                        className={`w-3 h-3 rounded-full ${statusColor} ${
                          node.status === "Online"
                            ? "shadow-[0_0_6px_rgba(34,197,94,0.5)]"
                            : ""
                        }`}
                      />
                    </button>
                  );
                }

                // Expanded view
                return (
                  <button
                    key={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                    className={`w-full text-left p-2 rounded-md transition-colors flex items-center gap-2 ${
                      isSelected
                        ? "bg-accent"
                        : "hover:bg-accent/50"
                    }`}
                  >
                    <div
                      className={`w-2 h-2 rounded-full shrink-0 ${statusColor} ${
                        node.status === "Online"
                          ? "shadow-[0_0_6px_rgba(34,197,94,0.5)]"
                          : ""
                      }`}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">
                        {node.hostname}
                      </div>
                      {node.ipAddress && (
                        <div className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          {node.ipAddress}
                        </div>
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
                  </button>
                );
              })}
          </div>
        </ScrollArea>

        {/* Sidebar Footer */}
        {!isLoading && !isError && !sidebarCollapsed && (
          <div className="p-2 border-t border-border text-xs text-muted-foreground text-center">
            {filtered.length} of {nodes?.length ?? 0} nodes
          </div>
        )}
      </div>

      {/* Main Content - Node Details */}
      <div className="flex-1 overflow-auto">
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
      </div>
    </div>
  );
}
