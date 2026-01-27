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
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertCircle,
  Server,
  Globe,
  ChevronRight,
  PanelLeftClose,
  PanelLeft,
  LayoutGrid,
  List as ListIcon,
  ArrowUpCircle,
} from "lucide-react";
import { MachineOnboardingModal } from "@/components/MachineOnboardingModal";
import { NodeDetailView } from "@/components/NodeDetailView";
import { NetworkMap } from "@/components/NetworkMap";
import { fetchNodes } from "@/api";
import type { Node, NodeStatus } from "@/types";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAgentUpdateCheck } from "@/hooks/useAgentUpdateCheck";
import { cn } from "@/lib/utils";

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

function NodeListItem({
  node,
  isSelected,
  collapsed,
  isMobile,
  onSelect,
}: {
  node: Node;
  isSelected: boolean;
  collapsed: boolean;
  isMobile: boolean;
  onSelect: () => void;
}) {
  const statusColor =
    node.status === "Online"
      ? "bg-green-500"
      : node.status === "Offline"
      ? "bg-red-500"
      : node.status === "Maintenance"
      ? "bg-yellow-500"
      : "bg-muted";
  
  const { hasUpdate, latestVersion, loading: updateCheckLoading } = useAgentUpdateCheck(
    node.id,
    node.agentVersion
  );

  if (collapsed && !isMobile) {
    // Collapsed view - just status indicator
    return (
      <button
        onClick={onSelect}
        className="w-full p-2 rounded-md transition-colors flex items-center justify-center hover:bg-accent/50"
        title={node.hostname}
      >
        <div
          className={`w-3 h-3 rounded-full ${statusColor} ${
            node.status === "Online" ? "shadow-[0_0_6px_rgba(34,197,94,0.5)]" : ""
          }`}
        />
      </button>
    );
  }

  // Expanded view
  return (
    <button
      onClick={onSelect}
      className={cn(
        "w-full text-left p-2 rounded-md transition-colors flex items-center gap-2",
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      )}
    >
      <div
        className={`w-2 h-2 rounded-full shrink-0 ${statusColor} ${
          node.status === "Online" ? "shadow-[0_0_6px_rgba(34,197,94,0.5)]" : ""
        }`}
      />
      <div className="flex-1 min-w-0">
        <div className="font-medium text-sm truncate flex items-center gap-2">
          {node.hostname}
          {!updateCheckLoading && hasUpdate && (
            <Tooltip>
              <TooltipTrigger asChild>
                <ArrowUpCircle className="h-4 w-4 text-blue-500 shrink-0" />
              </TooltipTrigger>
              <TooltipContent>
                <p className="font-semibold">Update available</p>
                <p className="text-sm text-muted-foreground">
                  Upgrade to v{latestVersion}
                </p>
              </TooltipContent>
            </Tooltip>
          )}
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
            isSelected ? "text-primary" : "text-muted-foreground/50"
          }`}
        />
      </div>
    </button>
  );
}

export function NodesPage() {
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<NodeStatus | "All">("All");
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const isMobile = useIsMobile();

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

  // Auto-select first node if none is selected (Desktop only)
  // Disable auto-select in Map mode to ensure Map is visible initially
  const effectiveSelectedId =
    selectedNodeId && filtered.find((n) => n.id === selectedNodeId)
      ? selectedNodeId
      : !isMobile && filtered.length > 0 && viewMode === "list"
      ? filtered[0].id
      : null;

  // If mobile and a node is selected, show details. Otherwise show list.
  // In Map mode on mobile, we treat the Map as the "Detail" view (hiding the list)
  const showList = !isMobile || (!effectiveSelectedId && viewMode === "list");
  const showDetails = !isMobile || effectiveSelectedId || viewMode === "map";

  return (
    <div className="flex h-[calc(100vh-5rem)] -m-4 -mb-8 relative overflow-hidden">
      {/* Sidebar Panel */}
      <div
        className={cn(
          "flex flex-col border-r border-border bg-sidebar transition-all duration-300 absolute inset-0 z-20 md:relative md:z-0",
          sidebarCollapsed ? "md:w-12" : "md:w-80",
          showList ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          !showList && isMobile && "invisible" // Hide from access tree when offscreen on mobile
        )}
      >
        {/* Sidebar Header */}
        <div className="flex items-center justify-between p-2 border-b border-border">
          {(!sidebarCollapsed || isMobile) && (
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
          {!isMobile && (
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
          )}
        </div>

        {/* View Toggle (Only show if not collapsed or on mobile) */}
        {(!sidebarCollapsed || isMobile) && (
            <div className="px-2 pt-2">
                <div className="flex items-center p-1 bg-muted/50 rounded-lg border border-border">
                    <Button
                        variant={viewMode === "list" ? "secondary" : "ghost"}
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => setViewMode("list")}
                    >
                        <ListIcon className="w-3.5 h-3.5 mr-1.5" />
                        List
                    </Button>
                    <Button
                        variant={viewMode === "map" ? "secondary" : "ghost"}
                        size="sm"
                        className="flex-1 h-7 text-xs"
                        onClick={() => setViewMode("map")}
                    >
                        <LayoutGrid className="w-3.5 h-3.5 mr-1.5" />
                        Map
                    </Button>
                </div>
            </div>
        )}

        {/* Filter Controls - hidden when collapsed (Desktop) */}
        {(!sidebarCollapsed || isMobile) && (
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
          <div className={sidebarCollapsed && !isMobile ? "p-1" : "p-2 space-y-1"}>
            {/* Loading Skeletons */}
            {isLoading &&
              [...Array(5)].map((_, i) => (
                <div
                  key={i}
                  className={`rounded-md ${
                    sidebarCollapsed && !isMobile ? "p-1" : "p-2"
                  }`}
                >
                  {sidebarCollapsed && !isMobile ? (
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
            {isError && (!sidebarCollapsed || isMobile) && (
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
            {!isLoading &&
              !isError &&
              filtered.length === 0 &&
              (!sidebarCollapsed || isMobile) && (
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
              filtered.map((node: Node) => (
                <NodeListItem
                  key={node.id}
                  node={node}
                  isSelected={node.id === effectiveSelectedId}
                  collapsed={sidebarCollapsed && !isMobile}
                  isMobile={isMobile}
                  onSelect={() => setSelectedNodeId(node.id)}
                />
              ))}
          </div>
        </ScrollArea>

        {/* Sidebar Footer */}
        {!isLoading && !isError && (!sidebarCollapsed || isMobile) && (
          <div className="p-2 border-t border-border text-xs text-muted-foreground text-center">
            {filtered.length} of {nodes?.length ?? 0} nodes
          </div>
        )}
      </div>

      {/* Main Content - Node Details or Map */}
      <div
        className={cn(
          "flex-1 overflow-y-auto overflow-x-hidden bg-background transition-all duration-300 md:translate-x-0 relative",
          // Mobile: slide in when details shown
          isMobile && showDetails ? "translate-x-0" : isMobile ? "translate-x-full fixed inset-0 z-30" : ""
        )}
      >
        {viewMode === "map" && !effectiveSelectedId ? (
            <>
                {isMobile && (
                    <Button 
                        variant="secondary" 
                        size="sm" 
                        className="absolute top-4 left-4 z-50 shadow-md"
                        onClick={() => setViewMode("list")}
                    >
                        <ListIcon className="w-4 h-4 mr-2" />
                        List View
                    </Button>
                )}
                <NetworkMap 
                    nodes={filtered} 
                    selectedNodeId={selectedNodeId}
                    onNodeSelect={(id) => setSelectedNodeId(id)}
                />
            </>
        ) : effectiveSelectedId ? (
          <NodeDetailView
            nodeId={effectiveSelectedId}
            onBack={() => setSelectedNodeId(null)}
            showBackButton={isMobile || viewMode === "map"} 
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

