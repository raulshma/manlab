import { useState, useEffect, useRef, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import {
  fetchNodeSettings,
  upsertNodeSettings,
  triggerSystemUpdate,
  shutdownSystem,
  restartSystem,
  requestAgentPing,
  enableAgentTask,
  disableAgentTask,
  shutdownAgent,
  deleteNode,
} from "../../api";
import { useSignalR } from "../../SignalRContext";
import { ConfirmationModal } from "../ConfirmationModal";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Power, Activity, RefreshCw, Trash2, ToggleLeft, ToggleRight, Terminal, X, CheckCircle2 } from "lucide-react";

interface NodeSettingsTabProps {
  nodeId: string;
  nodeStatus: string;
  hostname: string;
}

export function NodeSettingsTab({ nodeId, nodeStatus, hostname }: NodeSettingsTabProps) {
  const queryClient = useQueryClient();

  // Fetch per-node settings
  const { data: nodeSettings } = useQuery({
    queryKey: ["nodeSettings", nodeId],
    queryFn: () => fetchNodeSettings(nodeId),
    refetchInterval: 30000,
  });

  const currentChannel =
    nodeSettings?.find((s) => s.key === "agent.update.channel")?.value ??
    "stable";

  const updateChannelMutation = useMutation({
    mutationFn: (channel: string) =>
      upsertNodeSettings(nodeId, [
        {
          key: "agent.update.channel",
          value: channel,
          category: "Updates",
          description: "Distribution channel used for agent updates (stable/beta).",
        },
      ]),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["nodeSettings", nodeId] });
    },
  });

  const updateMutation = useMutation({
    mutationFn: () => triggerSystemUpdate(nodeId),
  });

  // Live command output state
  const [activeCommandId, setActiveCommandId] = useState<string | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const { commandOutputLogs, subscribeToCommandOutput, unsubscribeFromCommandOutput, clearCommandOutputLogs } = useSignalR();

  // Get logs for the active command
  const activeLogs = useMemo(
    () => (activeCommandId ? commandOutputLogs.get(activeCommandId) ?? [] : []),
    [activeCommandId, commandOutputLogs]
  );
  const lastLogEntry = activeLogs[activeLogs.length - 1];
  const commandStatus = lastLogEntry?.status ?? "Pending";
  const isCommandComplete = commandStatus === "Completed" || commandStatus === "Failed" || commandStatus === "Cancelled";

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [activeLogs.length]);

  // Subscribe to command output when command starts
  useEffect(() => {
    if (activeCommandId) {
      subscribeToCommandOutput(activeCommandId);
      return () => {
        unsubscribeFromCommandOutput(activeCommandId);
      };
    }
  }, [activeCommandId, subscribeToCommandOutput, unsubscribeFromCommandOutput]);

  // Handle triggering system update with live logs
  const handleTriggerUpdate = async () => {
    const command = await updateMutation.mutateAsync();
    setActiveCommandId(command.id);
  };

  // Close live logs panel
  const handleCloseLogs = () => {
    if (activeCommandId) {
      clearCommandOutputLogs(activeCommandId);
    }
    setActiveCommandId(null);
  };

  const systemShutdownMutation = useMutation({
    mutationFn: (delaySeconds: number = 0) =>
      shutdownSystem(nodeId, delaySeconds),
  });

  const systemRestartMutation = useMutation({
    mutationFn: (delaySeconds: number = 0) =>
      restartSystem(nodeId, delaySeconds),
  });

  // Agent control mutations
  const pingMutation = useMutation({
    mutationFn: () => requestAgentPing(nodeId),
  });

  const enableAgentMutation = useMutation({
    mutationFn: () => enableAgentTask(nodeId),
  });

  const disableAgentMutation = useMutation({
    mutationFn: () => disableAgentTask(nodeId),
  });

  const restartAgentMutation = useMutation({
    mutationFn: () => shutdownAgent(nodeId),
  });

  const navigate = useNavigate();
  const deleteNodeMutation = useMutation({
    mutationFn: () => deleteNode(nodeId),
    onSuccess: () => {
      // Navigate back to dashboard after successful deletion
      queryClient.invalidateQueries({ queryKey: ["nodes"] });
      navigate("/");
    },
  });

  return (
    <div className="space-y-6 animate-in fade-in zoom-in-95 duration-200">
      {/* Update Settings */}
      <h2 className="text-lg font-semibold text-foreground">General Settings</h2>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-sm">Update Channel</CardTitle>
              <CardDescription>
                Controls which agent update track this node follows.
              </CardDescription>
            </div>
            <div className="min-w-45">
              <Select
                value={currentChannel}
                onValueChange={(value) => {
                  if (value === null) return;
                  updateChannelMutation.mutate(value);
                }}
                disabled={updateChannelMutation.isPending}
              >
                <SelectTrigger className="h-9 w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="stable">stable</SelectItem>
                  <SelectItem value="beta">beta</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {updateChannelMutation.isError && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {updateChannelMutation.error instanceof Error
                  ? updateChannelMutation.error.message
                  : "Failed to update channel"}
              </AlertDescription>
            </Alert>
          )}
          {updateChannelMutation.isSuccess && (
            <Alert className="mt-3">
              <AlertDescription>Update channel saved.</AlertDescription>
            </Alert>
          )}
        </CardHeader>
      </Card>

      {/* System Actions */}
      <h2 className="text-lg font-semibold text-foreground pt-4">System Actions</h2>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm">System Update</CardTitle>
              <CardDescription>
                Run system package updates on this node.
              </CardDescription>
            </div>
            <ConfirmationModal
              trigger={
                <Button
                  variant="secondary"
                  disabled={nodeStatus !== "Online" || activeCommandId !== null}
                >
                  Update System
                </Button>
              }
              title="Confirm System Update"
              message={`Are you sure you want to run a system update on "${hostname}"? This may require a reboot and could cause temporary service interruption.`}
              confirmText="Run Update"
              isDestructive
              isLoading={updateMutation.isPending}
              onConfirm={handleTriggerUpdate}
            />
          </div>
          {nodeStatus !== "Online" && (
            <p className="text-xs text-muted-foreground mt-3">
              ⚠️ System actions are only available when the node is online.
            </p>
          )}

          {/* Live Logs Panel */}
          {activeCommandId && (
            <Card className="mt-4 bg-muted/30 border-border">
              <CardHeader className="py-2 px-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    <span className="text-sm font-medium">Live Output</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      commandStatus === "Completed" ? "bg-green-500/20 text-green-600" :
                      commandStatus === "Failed" ? "bg-red-500/20 text-red-600" :
                      commandStatus === "Cancelled" ? "bg-yellow-500/20 text-yellow-600" :
                      "bg-blue-500/20 text-blue-600 animate-pulse"
                    }`}>
                      {commandStatus}
                    </span>
                  </div>
                  {isCommandComplete && (
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={handleCloseLogs}>
                      <X className="h-3 w-3" />
                    </Button>
                  )}
                </div>
              </CardHeader>
              <CardContent className="p-0">
                <ScrollArea className="h-48">
                  <div
                    ref={logContainerRef}
                    className="px-3 py-2 font-mono text-xs whitespace-pre-wrap break-all"
                  >
                    {activeLogs.length === 0 ? (
                      <span className="text-muted-foreground">Waiting for output...</span>
                    ) : (
                      activeLogs.map((entry, i) => (
                        <div key={i}>
                          {entry.logs}
                        </div>
                      ))
                    )}
                  </div>
                </ScrollArea>
                {isCommandComplete && (
                  <div className={`px-3 py-2 border-t flex items-center gap-2 text-sm ${
                    commandStatus === "Completed" ? "text-green-600" :
                    commandStatus === "Failed" ? "text-red-600" :
                    "text-yellow-600"
                  }`}>
                    {commandStatus === "Completed" ? (
                      <CheckCircle2 className="h-4 w-4" />
                    ) : (
                      <AlertCircle className="h-4 w-4" />
                    )}
                    <span>
                      {commandStatus === "Completed" ? "Update completed successfully" :
                       commandStatus === "Failed" ? "Update failed" :
                       "Update was cancelled"}
                    </span>
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </CardHeader>
      </Card>

      {/* System Power Control */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Power className="h-4 w-4" />
                System Power Control
              </CardTitle>
              <CardDescription>
                Shutdown or restart the entire machine.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <ConfirmationModal
                trigger={
                  <Button
                    variant="destructive"
                    disabled={nodeStatus !== "Online"}
                  >
                    Shutdown
                  </Button>
                }
                title="Shutdown System"
                message={`Are you sure you want to SHUTDOWN the machine "${hostname}"? This will power off the machine and it will need to be manually powered back on or woken via Wake-on-LAN.`}
                confirmText="Shutdown Now"
                isDestructive
                isLoading={systemShutdownMutation.isPending}
                onConfirm={async () => {
                  await systemShutdownMutation.mutateAsync(0);
                }}
              />
              <ConfirmationModal
                trigger={
                  <Button
                    variant="secondary"
                    disabled={nodeStatus !== "Online"}
                  >
                    Restart
                  </Button>
                }
                title="Restart System"
                message={`Are you sure you want to RESTART the machine "${hostname}"? This will reboot the entire machine.`}
                confirmText="Restart Now"
                isDestructive
                isLoading={systemRestartMutation.isPending}
                onConfirm={async () => {
                  await systemRestartMutation.mutateAsync(0);
                }}
              />
            </div>
          </div>
          {(systemShutdownMutation.isSuccess || systemRestartMutation.isSuccess) && (
            <Alert className="mt-3">
              <AlertDescription>
                {systemShutdownMutation.isSuccess
                  ? "Shutdown command sent. Machine will shut down."
                  : "Restart command sent. Machine will reboot."}
              </AlertDescription>
            </Alert>
          )}
          {(systemShutdownMutation.isError || systemRestartMutation.isError) && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {systemShutdownMutation.error instanceof Error
                  ? systemShutdownMutation.error.message
                  : systemRestartMutation.error instanceof Error
                  ? systemRestartMutation.error.message
                  : "Failed to send power command"}
              </AlertDescription>
            </Alert>
          )}
        </CardHeader>
      </Card>

      {/* Agent Management */}
      <h2 className="text-lg font-semibold text-foreground pt-4">Agent Management</h2>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <Activity className="h-4 w-4" />
                Request Ping
              </CardTitle>
              <CardDescription>
                Send an immediate ping request to verify agent connectivity.
              </CardDescription>
            </div>
            <Button
              variant="outline"
              onClick={() => pingMutation.mutate()}
              disabled={nodeStatus !== "Online" || pingMutation.isPending}
            >
              {pingMutation.isPending ? "Pinging..." : "Ping Agent"}
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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <ToggleRight className="h-4 w-4" />
                Enable/Disable Agent Task
              </CardTitle>
              <CardDescription>
                Control the agent's scheduled task. Disabling prevents automatic startup.
              </CardDescription>
            </div>
            <div className="flex gap-2">
              <ConfirmationModal
                trigger={
                  <Button
                    variant="outline"
                    disabled={nodeStatus !== "Online" || enableAgentMutation.isPending}
                  >
                    <ToggleRight className="h-4 w-4 mr-2" />
                    Enable
                  </Button>
                }
                title="Enable Agent Task"
                message={`Are you sure you want to enable the agent task on "${hostname}"? The agent will start automatically on system boot.`}
                confirmText="Enable Task"
                isLoading={enableAgentMutation.isPending}
                onConfirm={async () => {
                  await enableAgentMutation.mutateAsync();
                }}
              />
              <ConfirmationModal
                trigger={
                  <Button
                    variant="secondary"
                    disabled={nodeStatus !== "Online" || disableAgentMutation.isPending}
                  >
                    <ToggleLeft className="h-4 w-4 mr-2" />
                    Disable
                  </Button>
                }
                title="Disable Agent Task"
                message={`Are you sure you want to disable the agent task on "${hostname}"? The agent will not start automatically on system boot.`}
                confirmText="Disable Task"
                isDestructive
                isLoading={disableAgentMutation.isPending}
                onConfirm={async () => {
                  await disableAgentMutation.mutateAsync();
                }}
              />
            </div>
          </div>
          {(enableAgentMutation.isSuccess || disableAgentMutation.isSuccess) && (
            <Alert className="mt-3">
              <AlertDescription>
                {enableAgentMutation.isSuccess
                  ? "Agent task enabled successfully."
                  : "Agent task disabled successfully."}
              </AlertDescription>
            </Alert>
          )}
          {(enableAgentMutation.isError || disableAgentMutation.isError) && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {enableAgentMutation.error instanceof Error
                  ? enableAgentMutation.error.message
                  : disableAgentMutation.error instanceof Error
                  ? disableAgentMutation.error.message
                  : "Failed to update agent task"}
              </AlertDescription>
            </Alert>
          )}
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2">
                <RefreshCw className="h-4 w-4" />
                Restart Agent
              </CardTitle>
              <CardDescription>
                Gracefully restart the agent to apply updates or configuration changes.
              </CardDescription>
            </div>
            <ConfirmationModal
              trigger={
                <Button
                  variant="secondary"
                  disabled={nodeStatus !== "Online"}
                >
                  Restart Agent
                </Button>
              }
              title="Restart Agent"
              message={`Are you sure you want to restart the agent on "${hostname}"? The agent will temporarily disconnect and reconnect after restarting.`}
              confirmText="Restart Now"
              isLoading={restartAgentMutation.isPending}
              onConfirm={async () => {
                await restartAgentMutation.mutateAsync();
              }}
            />
          </div>
          {restartAgentMutation.isSuccess && (
            <Alert className="mt-3">
              <AlertDescription>Restart command sent. Agent will reconnect shortly.</AlertDescription>
            </Alert>
          )}
          {restartAgentMutation.isError && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {restartAgentMutation.error instanceof Error
                  ? restartAgentMutation.error.message
                  : "Failed to restart agent"}
              </AlertDescription>
            </Alert>
          )}
          {nodeStatus !== "Online" && (
            <p className="text-xs text-muted-foreground mt-3">
              ⚠️ Agent management actions are only available when the node is online.
            </p>
          )}
        </CardHeader>
      </Card>

      {/* Danger Zone */}
      <h2 className="text-lg font-semibold text-destructive pt-4">Danger Zone</h2>
      <Card className="border-destructive/50">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm flex items-center gap-2 text-destructive">
                <Trash2 className="h-4 w-4" />
                Delete Node
              </CardTitle>
              <CardDescription>
                Permanently remove this node from ManLab. This action cannot be undone.
              </CardDescription>
            </div>
            <ConfirmationModal
              trigger={
                <Button variant="destructive">
                  Delete Node
                </Button>
              }
              title="Delete Node"
              message={`Are you sure you want to permanently delete "${hostname}"? This will remove all telemetry data, settings, and command history. If the agent is connected, it will be uninstalled. This action cannot be undone.`}
              confirmText="Delete Permanently"
              isDestructive
              isLoading={deleteNodeMutation.isPending}
              onConfirm={async () => {
                await deleteNodeMutation.mutateAsync();
              }}
            />
          </div>
          {deleteNodeMutation.isError && (
            <Alert variant="destructive" className="mt-3">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {deleteNodeMutation.error instanceof Error
                  ? deleteNodeMutation.error.message
                  : "Failed to delete node"}
              </AlertDescription>
            </Alert>
          )}
        </CardHeader>
      </Card>
    </div>
  );
}
