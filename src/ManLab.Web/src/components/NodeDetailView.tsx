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
import { ArrowLeft, AlertCircle, Trash2, RefreshCw, Clock, Power, Play, Square } from "lucide-react";
import type { Container } from "../types";
import { useSignalR } from "../SignalRContext";
import {
  fetchNode,
  fetchNodeTelemetry,
  fetchNodeCommands,
  requestDockerContainerList,
  restartContainer,
  triggerSystemUpdate,
  deleteNode,
  requestAgentPing,
  shutdownAgent,
  enableAgentTask,
  disableAgentTask,
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
 * Formats a future date to countdown (e.g., "in 30 seconds").
 */
function formatCountdown(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = date.getTime() - now.getTime();

  if (diffMs <= 0) {
    return "now";
  }

  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);

  if (diffSeconds < 60) {
    return `in ${diffSeconds} second${diffSeconds !== 1 ? "s" : ""}`;
  } else if (diffMinutes < 60) {
    const remainingSeconds = diffSeconds % 60;
    if (remainingSeconds > 0) {
      return `in ${diffMinutes}m ${remainingSeconds}s`;
    }
    return `in ${diffMinutes} minute${diffMinutes !== 1 ? "s" : ""}`;
  } else {
    const hours = Math.floor(diffMinutes / 60);
    const mins = diffMinutes % 60;
    return `in ${hours}h ${mins}m`;
  }
}

/**
 * NodeDetailView displays detailed information about a specific node.
 */
export function NodeDetailView({ nodeId, onBack }: NodeDetailViewProps) {
  const { agentBackoffStatus } = useSignalR();
  const backoffStatus = agentBackoffStatus.get(nodeId);

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
      // The output may contain agent dispatch messages before the actual JSON.
      // Extract the JSON portion by finding the first '[' or '{' character.
      let jsonContent = latestSuccessfulDockerList.outputLog;
      const arrayStart = jsonContent.indexOf('[');
      const objectStart = jsonContent.indexOf('{');
      
      // Determine which comes first (or only one exists)
      let jsonStart = -1;
      if (arrayStart >= 0 && objectStart >= 0) {
        jsonStart = Math.min(arrayStart, objectStart);
      } else if (arrayStart >= 0) {
        jsonStart = arrayStart;
      } else if (objectStart >= 0) {
        jsonStart = objectStart;
      }
      
      if (jsonStart > 0) {
        jsonContent = jsonContent.substring(jsonStart);
      }
      
      const parsed = JSON.parse(jsonContent);
      if (Array.isArray(parsed)) {
        dockerContainers = parsed as Container[];
      } else if (
        parsed &&
        typeof parsed === "object" &&
        typeof parsed.error === "string"
      ) {
        dockerListError = parsed.error;
      } else {
        // Unexpected structure
        dockerListError = `Unexpected response format: ${JSON.stringify(parsed).substring(0, 100)}`;
      }
    } catch (e) {
      const preview = latestSuccessfulDockerList.outputLog.substring(0, 100);
      dockerListError = `Failed to parse docker list output: ${e instanceof Error ? e.message : "Unknown error"}. Preview: ${preview}`;
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

  // Ping agent mutation
  const pingMutation = useMutation({
    mutationFn: () => requestAgentPing(nodeId),
  });

  // Agent control mutations
  const shutdownMutation = useMutation({
    mutationFn: () => shutdownAgent(nodeId),
  });

  const enableTaskMutation = useMutation({
    mutationFn: () => enableAgentTask(nodeId),
  });

  const disableTaskMutation = useMutation({
    mutationFn: () => disableAgentTask(nodeId),
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

      {/* Backoff Status Alert */}
      {backoffStatus && (
        <div className="max-w-7xl mx-auto px-6 pt-4">
          <Alert variant="destructive">
            <Clock className="h-4 w-4" />
            <AlertTitle>Agent Heartbeat Backoff Active</AlertTitle>
            <AlertDescription className="flex items-center justify-between">
              <span>
                Failed to send {backoffStatus.consecutiveFailures} consecutive heartbeat{backoffStatus.consecutiveFailures !== 1 ? "s" : ""}.
                Next ping expected{" "}
                <strong>{formatCountdown(backoffStatus.nextRetryTimeUtc ?? "")}</strong>.
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => pingMutation.mutate()}
                disabled={pingMutation.isPending}
                className="ml-4"
              >
                {pingMutation.isPending ? (
                  <>
                    <Spinner className="h-4 w-4 mr-2" />
                    Pinging...
                  </>
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-2" />
                    Ping Now
                  </>
                )}
              </Button>
            </AlertDescription>
          </Alert>
          {pingMutation.isError && (
            <Alert variant="destructive" className="mt-2">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {pingMutation.error instanceof Error
                  ? pingMutation.error.message
                  : "Failed to send ping request"}
              </AlertDescription>
            </Alert>
          )}
        </div>
      )}

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

          {/* Ping Agent */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <RefreshCw className="h-4 w-4" />
                    Ping Agent
                  </CardTitle>
                  <CardDescription>
                    Request an immediate connectivity check from the agent.
                    Resets any heartbeat backoff if successful.
                  </CardDescription>
                </div>
                <Button
                  variant="secondary"
                  disabled={node.status !== "Online" || pingMutation.isPending}
                  onClick={() => pingMutation.mutate()}
                >
                  {pingMutation.isPending ? (
                    <>
                      <Spinner className="h-4 w-4 mr-2" />
                      Pinging...
                    </>
                  ) : (
                    "Ping Now"
                  )}
                </Button>
              </div>
              {pingMutation.isSuccess && (
                <Alert className="mt-3">
                  <AlertDescription>Ping request sent successfully.</AlertDescription>
                </Alert>
              )}
              {pingMutation.isError && (
                <Alert variant="destructive" className="mt-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {pingMutation.error instanceof Error
                      ? pingMutation.error.message
                      : "Failed to send ping request"}
                  </AlertDescription>
                </Alert>
              )}
            </CardHeader>
          </Card>

          {/* Agent Control - Enable/Disable Task */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Power className="h-4 w-4" />
                    Agent Scheduled Task
                  </CardTitle>
                  <CardDescription>
                    Enable or disable the agent's Windows scheduled task.
                    Disabling prevents the agent from auto-starting.
                  </CardDescription>
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="secondary"
                    disabled={node.status !== "Online" || enableTaskMutation.isPending}
                    onClick={() => enableTaskMutation.mutate()}
                  >
                    {enableTaskMutation.isPending ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <>
                        <Play className="h-4 w-4 mr-1" />
                        Enable
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={node.status !== "Online" || disableTaskMutation.isPending}
                    onClick={() => disableTaskMutation.mutate()}
                  >
                    {disableTaskMutation.isPending ? (
                      <Spinner className="h-4 w-4" />
                    ) : (
                      <>
                        <Square className="h-4 w-4 mr-1" />
                        Disable
                      </>
                    )}
                  </Button>
                </div>
              </div>
              {(enableTaskMutation.isSuccess || disableTaskMutation.isSuccess) && (
                <Alert className="mt-3">
                  <AlertDescription>Task control command sent successfully.</AlertDescription>
                </Alert>
              )}
              {(enableTaskMutation.isError || disableTaskMutation.isError) && (
                <Alert variant="destructive" className="mt-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>Failed to send task control command.</AlertDescription>
                </Alert>
              )}
            </CardHeader>
          </Card>

          {/* Shutdown Agent */}
          <Card className="mt-4">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Power className="h-4 w-4" />
                    Shutdown Agent
                  </CardTitle>
                  <CardDescription>
                    Gracefully terminate the agent process. The agent will
                    restart automatically via its scheduled task.
                  </CardDescription>
                </div>
                <ConfirmationModal
                  trigger={
                    <Button
                      variant="secondary"
                      disabled={node.status !== "Online"}
                    >
                      Shutdown
                    </Button>
                  }
                  title="Shutdown Agent"
                  message={`Are you sure you want to shutdown the agent on "${node.hostname}"? The agent will terminate and restart via its scheduled task.`}
                  confirmText="Shutdown"
                  isDestructive
                  isLoading={shutdownMutation.isPending}
                  onConfirm={async () => {
                    await shutdownMutation.mutateAsync();
                  }}
                />
              </div>
              {shutdownMutation.isSuccess && (
                <Alert className="mt-3">
                  <AlertDescription>Shutdown command sent. Agent will restart shortly.</AlertDescription>
                </Alert>
              )}
              {shutdownMutation.isError && (
                <Alert variant="destructive" className="mt-3">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>
                    {shutdownMutation.error instanceof Error
                      ? shutdownMutation.error.message
                      : "Failed to send shutdown command"}
                  </AlertDescription>
                </Alert>
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
