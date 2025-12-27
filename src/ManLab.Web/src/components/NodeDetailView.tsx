/**
 * NodeDetailView component for detailed node information.
 * Shows telemetry charts, Docker containers, and system actions.
 */

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/spinner";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, AlertCircle, Trash2 } from "lucide-react";
import type { Container } from "../types";
import {
  fetchNode,
  fetchNodeTelemetry,
  fetchNodeCommands,
  requestDockerContainerList,
  restartContainer,
  triggerSystemUpdate,
  deleteNode,
} from "../api";
import { TelemetryChart } from "./TelemetryChart";
import { ContainerList } from "./ContainerList";
import { ConfirmationModal } from "./ConfirmationModal";
import { NodeCommandsPanel } from "./NodeCommandsPanel";

interface NodeDetailViewProps {
  nodeId: string;
  onBack: () => void;
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
    return `${diffMinutes} minute${diffMinutes > 1 ? "s" : ""} ago`;
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  } else {
    return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;
  }
}

/**
 * NodeDetailView displays detailed information about a specific node.
 */
export function NodeDetailView({ nodeId, onBack }: NodeDetailViewProps) {
  // Fetch node details
  const {
    data: node,
    isLoading: nodeLoading,
    error: nodeError,
  } = useQuery({
    queryKey: ["node", nodeId],
    queryFn: () => fetchNode(nodeId),
  });

  // Fetch telemetry history
  const { data: telemetry } = useQuery({
    queryKey: ["telemetry", nodeId],
    queryFn: () => fetchNodeTelemetry(nodeId, 30),
    refetchInterval: 10000, // Refetch every 10 seconds
  });

  // Fetch command history (used for docker container list + command panel)
  const { data: commands } = useQuery({
    queryKey: ["commands", nodeId],
    queryFn: () => fetchNodeCommands(nodeId, 50),
    refetchInterval: 5000,
  });

  const dockerListCommand = (commands ?? []).find(
    (c) => c.commandType === "DockerList" && c.status !== "Failed"
  );
  const latestSuccessfulDockerList = (commands ?? []).find(
    (c) =>
      c.commandType === "DockerList" && c.status === "Success" && !!c.outputLog
  );

  let dockerContainers: Container[] = [];
  let dockerListError: string | null = null;
  if (latestSuccessfulDockerList?.outputLog) {
    try {
      const parsed = JSON.parse(latestSuccessfulDockerList.outputLog);
      if (Array.isArray(parsed)) {
        dockerContainers = parsed as Container[];
      } else if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.error === "string"
      ) {
        dockerListError = parsed.error;
      }
    } catch {
      dockerListError = "Failed to parse docker list output.";
    }
  }

  const isDockerListRunning =
    dockerListCommand?.status === "Queued" ||
    dockerListCommand?.status === "InProgress";

  const dockerListMutation = useMutation({
    mutationFn: () => requestDockerContainerList(nodeId),
  });

  // Restart container mutation
  const restartMutation = useMutation({
    mutationFn: (containerId: string) => restartContainer(nodeId, containerId),
    onSuccess: () => {
      // Refresh the container list after restart
      dockerListMutation.mutate();
    },
  });

  // System update mutation
  const updateMutation = useMutation({
    mutationFn: () => triggerSystemUpdate(nodeId),
    onSuccess: () => {
      // Could show success notification
    },
  });

  // Delete node mutation
  const queryClient = useQueryClient();
  const deleteMutation = useMutation({
    mutationFn: () => deleteNode(nodeId),
    onSuccess: () => {
      // Invalidate nodes list and navigate back
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
      onBack();
    },
  });

  if (nodeLoading) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="flex items-center gap-3">
          <Spinner className="h-6 w-6" />
          <span className="text-muted-foreground">Loading node details...</span>
        </div>
      </div>
    );
  }

  if (nodeError || !node) {
    return (
      <div className="min-h-screen bg-background text-foreground flex items-center justify-center">
        <div className="text-center max-w-md">
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

  const statusVariant = getStatusVariant(node.status);

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Header */}
      <header className="bg-card border-b border-border px-6 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-4">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="w-5 h-5" />
            </Button>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <div
                  className={`w-3 h-3 rounded-full ${
                    node.status === "Online"
                      ? "bg-primary animate-pulse"
                      : node.status === "Offline"
                      ? "bg-destructive"
                      : node.status === "Maintenance"
                      ? "bg-secondary animate-pulse"
                      : "bg-muted"
                  }`}
                />
                <h1 className="text-xl font-semibold">{node.hostname}</h1>
                <Badge variant={statusVariant}>{node.status}</Badge>
              </div>
              <p className="text-sm text-muted-foreground mt-1">
                Last seen: {formatRelativeTime(node.lastSeen)}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Node Info Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="pt-4">
              <dt className="text-xs text-muted-foreground uppercase tracking-wider">
                IP Address
              </dt>
              <dd className="text-sm font-mono text-foreground mt-1">
                {node.ipAddress || "N/A"}
              </dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <dt className="text-xs text-muted-foreground uppercase tracking-wider">
                Operating System
              </dt>
              <dd className="text-sm text-foreground mt-1 truncate">
                {node.os || "N/A"}
              </dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <dt className="text-xs text-muted-foreground uppercase tracking-wider">
                Agent Version
              </dt>
              <dd className="text-sm text-foreground mt-1">
                {node.agentVersion ? `v${node.agentVersion}` : "N/A"}
              </dd>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4">
              <dt className="text-xs text-muted-foreground uppercase tracking-wider">
                Registered
              </dt>
              <dd className="text-sm text-foreground mt-1">
                {new Date(node.createdAt).toLocaleDateString()}
              </dd>
            </CardContent>
          </Card>
        </div>

        {/* Telemetry Charts */}
        <section className="mb-8">
          <h2 className="text-lg font-semibold text-foreground mb-4">
            System Telemetry
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <TelemetryChart
              data={telemetry || []}
              metric="cpuUsage"
              label="CPU Usage"
              color="hsl(var(--chart-1))"
            />
            <TelemetryChart
              data={telemetry || []}
              metric="ramUsage"
              label="RAM Usage"
              color="hsl(var(--chart-2))"
            />
            <TelemetryChart
              data={telemetry || []}
              metric="diskUsage"
              label="Disk Usage"
              color="hsl(var(--chart-3))"
            />
          </div>
        </section>

        {/* Docker Containers */}
        <section className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-foreground">
              Docker Containers
            </h2>
            <Button
              variant="outline"
              size="sm"
              disabled={
                node.status !== "Online" || dockerListMutation.isPending
              }
              onClick={() => dockerListMutation.mutate()}
            >
              Refresh
            </Button>
          </div>
          {dockerListError && (
            <Alert variant="destructive" className="mb-4">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Docker list failed</AlertTitle>
              <AlertDescription>{dockerListError}</AlertDescription>
            </Alert>
          )}
          <ContainerList
            containers={dockerContainers}
            isLoading={isDockerListRunning || dockerListMutation.isPending}
            onRestart={async (containerId) => {
              await restartMutation.mutateAsync(containerId);
            }}
          />
          {node.status !== "Online" && (
            <p className="text-xs text-muted-foreground mt-3">
              Docker queries are only available when the node is online.
            </p>
          )}
        </section>

        {/* Commands */}
        <section className="mb-8">
          <NodeCommandsPanel nodeId={nodeId} />
        </section>

        {/* System Actions */}
        <section>
          <h2 className="text-lg font-semibold text-foreground mb-4">
            System Actions
          </h2>
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">System Update</CardTitle>
                  <CardDescription>
                    Run system package updates on this node. This will update
                    all installed packages.
                  </CardDescription>
                </div>
                <ConfirmationModal
                  trigger={
                    <Button
                      variant="secondary"
                      disabled={node.status !== "Online"}
                    >
                      Update System
                    </Button>
                  }
                  title="Confirm System Update"
                  message={`Are you sure you want to run a system update on "${node.hostname}"? This may require a reboot and could cause temporary service interruption.`}
                  confirmText="Run Update"
                  isDestructive
                  isLoading={updateMutation.isPending}
                  onConfirm={async () => {
                    await updateMutation.mutateAsync();
                  }}
                />
              </div>
              {node.status !== "Online" && (
                <p className="text-xs text-muted-foreground mt-3">
                  ⚠️ System actions are only available when the node is online.
                </p>
              )}
            </CardHeader>
          </Card>
          
          {/* Delete Node */}
          <Card className="mt-4 border-destructive/50">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Trash2 className="h-4 w-4 text-destructive" />
                    Delete Node
                  </CardTitle>
                  <CardDescription>
                    Permanently remove this node and all its telemetry data.
                    This action cannot be undone.
                  </CardDescription>
                </div>
                <ConfirmationModal
                  trigger={
                    <Button variant="destructive">
                      Delete Node
                    </Button>
                  }
                  title="Delete Node"
                  message={`Are you sure you want to permanently delete "${node.hostname}"? This will remove all telemetry data and command history for this node. This action cannot be undone.`}
                  confirmText="Delete"
                  isDestructive
                  isLoading={deleteMutation.isPending}
                  onConfirm={async () => {
                    await deleteMutation.mutateAsync();
                  }}
                />
              </div>
              {deleteMutation.isError && (
                <Alert variant="destructive" className="mt-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle>Failed to delete node</AlertTitle>
                  <AlertDescription>
                    {deleteMutation.error instanceof Error
                      ? deleteMutation.error.message
                      : "Unknown error occurred"}
                  </AlertDescription>
                </Alert>
              )}
            </CardHeader>
          </Card>
        </section>
      </main>
    </div>
  );
}
