/**
 * NodeDetailView component for detailed node information.
 * Refactored to use a minimal tabbed interface with lazy loading.
 */

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { AlertCircle, ArrowLeft, Clock } from "lucide-react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { fetchNode, requestAgentPing } from "../api";
import type { Node } from "../types";

import { NodeOverviewTab } from "./node-detail/NodeOverviewTab";
import { NodeHealthTab } from "./node-detail/NodeHealthTab";
import { NodeWorkloadsTab } from "./node-detail/NodeWorkloadsTab";
import { NodeToolsTab } from "./node-detail/NodeToolsTab";
import { NodeSettingsTab } from "./node-detail/NodeSettingsTab";

interface NodeDetailViewProps {
  nodeId: string;
  onBack: () => void;
  showBackButton?: boolean;
}

/**
 * Returns badge variant based on node status.
 */
function getStatusVariant(
  status: string
): "default" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "Online":
      return "default";
    case "Offline":
      return "destructive";
    case "Maintenance":
      return "secondary";
    default:
      return "outline";
  }
}

/**
 * Formats a date string to a relative time (e.g., "2 minutes ago").
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSeconds < 60) {
    return "Just now";
  } else if (diffMinutes < 60) {
    return `${diffMinutes}m ago`;
  } else if (diffHours < 24) {
    return `${diffHours}h ago`;
  } else {
    return `${diffDays}d ago`;
  }
}

// Minimal Header Component
function NodeDetailHeader({ node, onBack, showBackButton = true }: { node: Node; onBack: () => void; showBackButton?: boolean }) {
    const statusVariant = getStatusVariant(node.status);

    return (
        <div className="flex items-center gap-4 py-6">
            {showBackButton && (
                <Button variant="ghost" size="icon" onClick={onBack} className="-ml-2">
                    <ArrowLeft className="w-5 h-5" />
                </Button>
            )}
            <div>
                <div className="flex items-center gap-3">
                    <h1 className="text-2xl font-bold tracking-tight">{node.hostname}</h1>
                    <div
                        className={`w-2.5 h-2.5 rounded-full ${
                            node.status === "Online"
                                ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]"
                                : node.status === "Offline"
                                ? "bg-red-500"
                                : node.status === "Maintenance"
                                ? "bg-yellow-500"
                                : "bg-muted"
                        }`}
                    />
                    <Badge variant={statusVariant} className="text-xs px-2 py-0 h-5 font-normal">
                        {node.status}
                    </Badge>
                </div>
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground mt-1 font-mono">
                    <span>{node.ipAddress || "No IP"}</span>
                    <span className="text-border">|</span>
                    <span className="truncate max-w-50" title={node.os ?? undefined}>{node.os || "Unknown OS"}</span>
                    <span className="text-border">|</span>
                    <span>v{node.agentVersion || "?"}</span>
                    <span className="text-border">|</span>
                    <span className="flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {formatRelativeTime(node.lastSeen)}
                    </span>
                </div>
            </div>
        </div>
    );
}


export function NodeDetailView({ nodeId, onBack, showBackButton = true }: NodeDetailViewProps) {
  // Fetch node details
  const {
    data: node,
    isLoading: nodeLoading,
    error: nodeError,
  } = useQuery({
    queryKey: ["node", nodeId],
    queryFn: () => fetchNode(nodeId),
  });

  // Ping agent mutation
  const pingMutation = useMutation({
    mutationFn: () => requestAgentPing(nodeId),
  });

  if (nodeLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  if (nodeError || !node) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center max-w-md p-6">
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Node Not Found</AlertTitle>
            <AlertDescription>
              The requested node could not be found.
            </AlertDescription>
          </Alert>
          <Button onClick={onBack}>Back to Dashboard</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <div className="max-w-7xl mx-auto w-full px-4 md:px-6 flex-1 flex flex-col">
        {/* Minimal Header */}
        <NodeDetailHeader node={node} onBack={onBack} showBackButton={showBackButton} />

        {/* Tabs Interface */}
        <Tabs defaultValue="overview" className="flex-1 flex flex-col space-y-6">
          <div className="border-b border-border">
            <TabsList className="bg-transparent h-auto p-0 gap-x-6 gap-y-2 flex-wrap justify-start">
              <TabsTrigger
                value="overview"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 text-muted-foreground hover:text-foreground transition-all"
              >
                Overview
              </TabsTrigger>
              <TabsTrigger
                value="health"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 text-muted-foreground hover:text-foreground transition-all"
              >
                Health
              </TabsTrigger>
              <TabsTrigger
                value="workloads"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 text-muted-foreground hover:text-foreground transition-all"
              >
                Workloads
              </TabsTrigger>
              <TabsTrigger
                value="tools"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 text-muted-foreground hover:text-foreground transition-all"
              >
                Tools
              </TabsTrigger>
              <TabsTrigger
                value="settings"
                className="data-[state=active]:bg-transparent data-[state=active]:shadow-none data-[state=active]:text-foreground data-[state=active]:border-b-2 data-[state=active]:border-primary rounded-none px-0 py-3 text-muted-foreground hover:text-foreground transition-all"
              >
                Settings
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="pb-10 min-h-125">
            <TabsContent value="overview" className="mt-0 focus-visible:outline-none">
                <NodeOverviewTab 
                    nodeId={nodeId} 
                    node={node}
                    onPing={() => pingMutation.mutate()}
                    isPingPending={pingMutation.isPending}
                />
            </TabsContent>
            
            <TabsContent value="health" className="mt-0 focus-visible:outline-none">
                <NodeHealthTab nodeId={nodeId} />
            </TabsContent>

            <TabsContent value="workloads" className="mt-0 focus-visible:outline-none">
                <NodeWorkloadsTab nodeId={nodeId} nodeStatus={node.status} />
            </TabsContent>

            <TabsContent value="tools" className="mt-0 focus-visible:outline-none">
                <NodeToolsTab nodeId={nodeId} nodeStatus={node.status} />
            </TabsContent>

            <TabsContent value="settings" className="mt-0 focus-visible:outline-none">
                <NodeSettingsTab nodeId={nodeId} nodeStatus={node.status} hostname={node.hostname} />
            </TabsContent>
          </div>
        </Tabs>
      </div>
    </div>
  );
}
