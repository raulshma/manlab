import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchNodes } from "@/api";
import type { Node, NodeStatus } from "@/types";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Empty,
  EmptyDescription,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

import { RemoteFileBrowser } from "@/components/RemoteFileBrowser";
import { DownloadProgressPanel } from "@/components/DownloadProgressPanel";

import {
  AlertCircle,
  Folder,
  Globe,
  PanelLeft,
  PanelLeftClose,
  Server,
  ArrowLeft,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";

function StatusDot({ status }: { status: NodeStatus }) {
  const cls =
    status === "Online"
      ? "bg-green-500 shadow-[0_0_6px_rgba(34,197,94,0.5)]"
      : status === "Offline"
        ? "bg-red-500"
        : status === "Maintenance"
          ? "bg-yellow-500"
          : "bg-muted";

  return <div className={`w-2 h-2 rounded-full shrink-0 ${cls}`} />;
}

export function FileBrowserPage() {
  const [query, setQuery] = useState("");
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

    return base.filter((n) => {
      if (!q) return true;
      return (
        n.hostname.toLowerCase().includes(q) ||
        (n.ipAddress ?? "").toLowerCase().includes(q) ||
        (n.os ?? "").toLowerCase().includes(q)
      );
    });
  }, [nodes, query]);

  const effectiveSelectedId =
    selectedNodeId && filtered.find((n) => n.id === selectedNodeId)
      ? selectedNodeId
      : !isMobile && filtered.length > 0
        ? filtered[0].id
        : null;

  const selectedNode = useMemo(() => {
    if (!effectiveSelectedId) return null;
    return (nodes ?? []).find((n) => n.id === effectiveSelectedId) ?? null;
  }, [nodes, effectiveSelectedId]);

  // If mobile and a node is selected, show details. Otherwise show list.
  const showList = !isMobile || !effectiveSelectedId;
  const showDetails = !isMobile || effectiveSelectedId;

  return (
    <div className="flex h-[calc(100vh-5rem)] -m-4 -mb-8 relative overflow-hidden">
      {/* Sidebar */}
      <div
        className={cn(
          "flex flex-col border-r border-border bg-sidebar transition-all duration-300 absolute inset-0 z-20 md:relative md:z-0",
          sidebarCollapsed ? "md:w-12" : "md:w-80",
          showList ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          !showList && isMobile && "invisible"
        )}
      >
        <div className="flex items-center justify-between p-2 border-b border-border">
          {(!sidebarCollapsed || isMobile) ? (
            <div className="flex items-center gap-2 px-2">
              <Folder className="h-4 w-4 text-muted-foreground" />
              <h2 className="text-sm font-semibold">File Browser</h2>
            </div>
          ) : (
            <div className="w-full flex justify-center">
              <Folder className="h-4 w-4 text-muted-foreground" />
            </div>
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

        {(!sidebarCollapsed || isMobile) && (
          <div className="p-2 space-y-2 border-b border-border">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search nodes…"
              className="h-8 text-sm"
            />
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className={sidebarCollapsed && !isMobile ? "p-1" : "p-2 space-y-1"}>
            {isLoading &&
              [...Array(6)].map((_, i) => (
                <div key={i} className={`rounded-md ${sidebarCollapsed && !isMobile ? "p-1" : "p-2"}`}>
                  {sidebarCollapsed && !isMobile ? (
                    <Skeleton className="w-8 h-8 rounded-md" />
                  ) : (
                    <div className="flex items-center gap-2">
                      <Skeleton className="w-2 h-2 rounded-full" />
                      <div className="flex-1 space-y-1">
                        <Skeleton className="h-4 w-28" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                  )}
                </div>
              ))}

            {isError && (!sidebarCollapsed || isMobile) && (
              <Alert variant="destructive" className="mx-1">
                <AlertCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  {error instanceof Error ? error.message : "Failed to load nodes"}
                </AlertDescription>
              </Alert>
            )}

            {!isLoading && !isError && filtered.length === 0 && (!sidebarCollapsed || isMobile) && (
              <Empty className="py-8 border-0">
                <EmptyMedia variant="icon">
                  <Server />
                </EmptyMedia>
                <EmptyTitle>No nodes found</EmptyTitle>
                <EmptyDescription>Try adjusting your search.</EmptyDescription>
              </Empty>
            )}

            {!isLoading &&
              !isError &&
              filtered.map((node: Node) => {
                const isSelected = node.id === effectiveSelectedId;

                if (sidebarCollapsed && !isMobile) {
                  return (
                    <button
                      key={node.id}
                      onClick={() => setSelectedNodeId(node.id)}
                      className={`w-full p-2 rounded-md transition-colors flex items-center justify-center ${
                        isSelected ? "bg-accent" : "hover:bg-accent/50"
                      }`}
                      title={node.hostname}
                    >
                      <StatusDot status={node.status} />
                    </button>
                  );
                }

                return (
                  <button
                    key={node.id}
                    onClick={() => setSelectedNodeId(node.id)}
                    className={cn(
                      "w-full text-left p-2 rounded-md transition-colors flex items-center gap-2",
                      isSelected ? "bg-accent" : "hover:bg-accent/50"
                    )}
                  >
                    <StatusDot status={node.status} />
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{node.hostname}</div>
                      {node.ipAddress && (
                        <div className="text-xs text-muted-foreground font-mono flex items-center gap-1">
                          <Globe className="w-3 h-3" />
                          {node.ipAddress}
                        </div>
                      )}
                    </div>
                    <div className="text-[10px] text-muted-foreground">{node.status}</div>
                  </button>
                );
              })}
          </div>
        </ScrollArea>
      </div>

      {/* Main */}
      <div
        className={cn(
          "flex-1 flex flex-col overflow-hidden bg-background transition-all duration-300 md:translate-x-0 relative",
          isMobile && showDetails ? "translate-x-0" : isMobile ? "translate-x-full fixed inset-0 z-30" : ""
        )}
      >
        <div className="flex-1 overflow-auto p-4 pb-16">
          {isMobile && selectedNode && (
            <Button
              variant="ghost"
              onClick={() => setSelectedNodeId(null)}
              className="mb-4 -ml-2 text-muted-foreground hover:text-foreground"
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Back to Nodes
            </Button>
          )}

          {selectedNode ? (
            <RemoteFileBrowser nodeId={selectedNode.id} nodeStatus={selectedNode.status} autoOpen />
          ) : (
            <Empty className="h-full border-0">
              <EmptyMedia variant="icon">
                <Folder />
              </EmptyMedia>
              <EmptyTitle>Select a Node</EmptyTitle>
              <EmptyDescription>
                Choose a node from the sidebar to browse its files.
              </EmptyDescription>
            </Empty>
          )}
        </div>
        
        {/* Download progress panel - Requirements: 7.1 */}
        <DownloadProgressPanel position="bottom" maxHeight="250px" />
      </div>
    </div>
  );
}

