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
  fetchAuditEvents,
  fetchOnboardingMachineForNode,
  fetchNodeCommands,
  fetchSuggestedServerBaseUrl,
  uninstallAgent,
} from "../../api";
import { useSignalR } from "../../SignalRContext";
import { ConfirmationModal } from "../ConfirmationModal";
import { AutoUpdateSettingsPanel } from "../autoupdate/AutoUpdateSettingsPanel";
import { SystemUpdateSettingsPanel } from "../systemupdate/SystemUpdateSettingsPanel";
import { SystemUpdateHistoryPanel } from "../systemupdate/SystemUpdateHistoryPanel";
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
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertCircle, Power, Activity, RefreshCw, Trash2, ToggleLeft, ToggleRight, Terminal, X, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";


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

  // Linked onboarding machine (for uninstall-on-delete)
  const linkedMachineQuery = useQuery({
    queryKey: ["onboardingMachineForNode", nodeId],
    queryFn: () => fetchOnboardingMachineForNode(nodeId),
    retry: false,
  });

  const suggestedUrlQuery = useQuery({
    queryKey: ["suggestedServerBaseUrl"],
    queryFn: fetchSuggestedServerBaseUrl,
    staleTime: 60_000,
  });

  const linkedMachine = linkedMachineQuery.data ?? null;
  const canUninstallFromMachine = !!linkedMachine && linkedMachine.hasSavedCredentials === true;

  const effectiveServerBaseUrlForMachine = useMemo(() => {
    const suggested = suggestedUrlQuery.data?.serverBaseUrl ?? "";
    if (!linkedMachine) return suggested;
    return linkedMachine.serverBaseUrlOverride ?? suggested;
  }, [linkedMachine, suggestedUrlQuery.data]);

  const [deleteAlsoUninstall, setDeleteAlsoUninstall] = useState(false);

  // Agent update history (durable audit events)
  const updateHistoryQuery = useQuery({
    queryKey: ["nodeAgentUpdateHistory", nodeId],
    queryFn: async () => {
      const events = await fetchAuditEvents({
        nodeId,
        category: "agents",
        take: 200,
      });

      return events
        .filter((e) => e.eventName === "agent.update.start" || e.eventName === "agent.update.completed")
        .sort((a, b) => new Date(a.timestampUtc).getTime() - new Date(b.timestampUtc).getTime());
    },
    staleTime: 10_000,
  });

  type UpdateAttempt = {
    startedAtUtc: string;
    completedAtUtc?: string;
    success?: boolean | null;
    actorName?: string | null;
    machineId?: string | null;
    agentSource?: string | null;
    agentChannel?: string | null;
    agentVersion?: string | null;
    reportedAgentVersion?: string | null;
    error?: string | null;
  };

  const updateAttempts: UpdateAttempt[] = useMemo(() => {
    const events = updateHistoryQuery.data ?? [];
    const starts = events.filter((e) => e.eventName === "agent.update.start");
    const completeds = events.filter((e) => e.eventName === "agent.update.completed");

    const parseData = (dataJson: string | null) => {
      if (!dataJson) return {} as Record<string, unknown>;
      try {
        return JSON.parse(dataJson) as Record<string, unknown>;
      } catch {
        return {} as Record<string, unknown>;
      }
    };

    const usedCompleted = new Set<string>();
    const attempts: UpdateAttempt[] = [];

    for (const s of starts) {
      const sData = parseData(s.dataJson);
      const sMachineId = s.machineId;
      const startTs = s.timestampUtc;

      let match: (typeof completeds)[number] | undefined;
      for (const c of completeds) {
        if (usedCompleted.has(c.id)) continue;
        if (sMachineId && c.machineId && c.machineId !== sMachineId) continue;
        if (new Date(c.timestampUtc).getTime() < new Date(startTs).getTime()) continue;
        match = c;
        break;
      }

      if (match) {
        usedCompleted.add(match.id);
      }

      const cData = match ? parseData(match.dataJson) : {};
      const agentSource = (cData.agentSource ?? sData.agentSource) as string | undefined;
      const agentChannel = (cData.agentChannel ?? sData.agentChannel) as string | undefined;
      const agentVersion = (cData.agentVersion ?? sData.agentVersion) as string | undefined;
      const reportedAgentVersion = (cData.reportedAgentVersion as string | undefined) ?? undefined;

      attempts.push({
        startedAtUtc: startTs,
        completedAtUtc: match?.timestampUtc,
        success: match?.success,
        actorName: s.actorName ?? match?.actorName,
        machineId: sMachineId ?? match?.machineId,
        agentSource: agentSource ?? null,
        agentChannel: agentChannel ?? null,
        agentVersion: agentVersion ?? null,
        reportedAgentVersion: reportedAgentVersion ?? null,
        error: match?.error ?? null,
      });
    }

    for (const c of completeds) {
      if (usedCompleted.has(c.id)) continue;
      const cData = parseData(c.dataJson);
      attempts.push({
        startedAtUtc: c.timestampUtc,
        completedAtUtc: c.timestampUtc,
        success: c.success,
        actorName: c.actorName,
        machineId: c.machineId,
        agentSource: (cData.agentSource as string | undefined) ?? null,
        agentChannel: (cData.agentChannel as string | undefined) ?? null,
        agentVersion: (cData.agentVersion as string | undefined) ?? null,
        reportedAgentVersion: (cData.reportedAgentVersion as string | undefined) ?? null,
        error: c.error,
      });
    }

    return attempts
      .sort((a, b) => new Date(b.startedAtUtc).getTime() - new Date(a.startedAtUtc).getTime())
      .slice(0, 20);
  }, [updateHistoryQuery.data]);

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
  const activeCommandStorageKey = `manlab:node:${nodeId}:active_command`;
  const [activeCommandId, setActiveCommandId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(activeCommandStorageKey);
    } catch {
      return null;
    }
  });
  const logContainerRef = useRef<HTMLDivElement>(null);
  const { commandOutputLogs, subscribeToCommandOutput, unsubscribeFromCommandOutput, clearCommandOutputLogs, syncCommandOutputSnapshot } = useSignalR();

  // Get logs for the active command
  const activeLogs = useMemo(
    () => (activeCommandId ? commandOutputLogs.get(activeCommandId) ?? [] : []),
    [activeCommandId, commandOutputLogs]
  );
  const lastLogEntry = activeLogs[activeLogs.length - 1];
  const commandStatus = lastLogEntry?.status ?? "Pending";
  const isCommandComplete = commandStatus === "Completed" || commandStatus === "Failed" || commandStatus === "Cancelled";

  // Auto-scroll to bottom when new logs arrive
  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    const viewport = logContainerRef.current?.closest("[data-slot='scroll-area-viewport']");
    if (viewport) {
      viewport.scrollTop = viewport.scrollHeight;
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

  // Hydrate output logs from server snapshots to avoid missing chunks during reloads
  useEffect(() => {
    if (!activeCommandId) return;

    let isCancelled = false;
    let intervalId: number | null = null;

    const hydrate = async () => {
      try {
        const commands = await fetchNodeCommands(nodeId, 50);
        const command = commands.find((c) => c.id === activeCommandId);
        if (!command || isCancelled) return;

        syncCommandOutputSnapshot(
          activeCommandId,
          nodeId,
          command.status,
          command.outputLog ?? null
        );

        if (["Completed", "Failed", "Cancelled"].includes(command.status)) {
          if (intervalId !== null) {
            window.clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch {
        // Best-effort sync only.
      }
    };

    hydrate();
    intervalId = window.setInterval(hydrate, 2000);

    return () => {
      isCancelled = true;
      if (intervalId !== null) {
        window.clearInterval(intervalId);
      }
    };
  }, [activeCommandId, nodeId, syncCommandOutputSnapshot]);

  useEffect(() => {
    try {
      if (activeCommandId) {
        localStorage.setItem(activeCommandStorageKey, activeCommandId);
      } else {
        localStorage.removeItem(activeCommandStorageKey);
      }
    } catch {
      // Best-effort persistence only.
    }
  }, [activeCommandId, activeCommandStorageKey]);

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
    mutationFn: async () => {
      if (deleteAlsoUninstall && linkedMachine) {
        if (!canUninstallFromMachine) {
          throw new Error("This node has a linked machine, but it does not have saved credentials. Save credentials in Onboarding first to uninstall via SSH.");
        }

        await uninstallAgent(linkedMachine.id, {
          serverBaseUrl: effectiveServerBaseUrlForMachine,
          trustHostKey: linkedMachine.trustHostKey ?? true,
          useSavedCredentials: true,
        });

        toast.info("Agent uninstall started", {
          description: `Uninstall job started for ${linkedMachine.username}@${linkedMachine.host}:${linkedMachine.port}.`,
        });
      }

      await deleteNode(nodeId);
    },
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
                <SelectTrigger className="h-9 w-45">
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

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-sm">Agent Version</CardTitle>
              <CardDescription>
                Pick a specific agent version from local staging or GitHub releases and reinstall/update this node.
              </CardDescription>
            </div>
            <Button variant="secondary" onClick={() => navigate(`/nodes/${nodeId}/update`)}>
              Update Agent Version...
            </Button>
          </div>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle className="text-sm">Agent Update History</CardTitle>
              <CardDescription>
                Recent agent update attempts for this node.
              </CardDescription>
            </div>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => queryClient.invalidateQueries({ queryKey: ["nodeAgentUpdateHistory", nodeId] })}
              disabled={updateHistoryQuery.isFetching}
            >
              {updateHistoryQuery.isFetching ? "Refreshing…" : "Refresh"}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {updateHistoryQuery.isLoading ? (
            <div className="text-sm text-muted-foreground">Loading update history…</div>
          ) : updateHistoryQuery.isError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {updateHistoryQuery.error instanceof Error
                  ? updateHistoryQuery.error.message
                  : "Failed to load update history"}
              </AlertDescription>
            </Alert>
          ) : updateAttempts.length === 0 ? (
            <div className="text-sm text-muted-foreground">No update history yet.</div>
          ) : (
            <ScrollArea className="h-64 rounded border">
              <div className="divide-y">
                {updateAttempts.map((a) => {
                  const running = !a.completedAtUtc;
                  const succeeded = a.success === true;
                  const failed = a.success === false;

                  const statusLabel = running ? "Running" : succeeded ? "Succeeded" : failed ? "Failed" : "Completed";

                  const selection = [a.agentSource, a.agentChannel, a.agentVersion]
                    .filter((x) => typeof x === "string" && x.length > 0)
                    .join(" / ");

                  return (
                    <div key={`${a.startedAtUtc}-${a.machineId ?? "none"}`} className="p-3 text-sm">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <span
                            className={
                              running
                                ? "text-muted-foreground"
                                : succeeded
                                  ? "text-green-600"
                                  : failed
                                    ? "text-red-600"
                                    : "text-foreground"
                            }
                          >
                            {statusLabel}
                          </span>
                          {selection ? <span className="text-muted-foreground">• {selection}</span> : null}
                          {a.reportedAgentVersion ? (
                            <span className="text-muted-foreground">• reported {a.reportedAgentVersion}</span>
                          ) : null}
                        </div>

                        <div className="text-xs text-muted-foreground">
                          Started: {new Date(a.startedAtUtc).toLocaleString()}
                          {a.completedAtUtc ? ` • Completed: ${new Date(a.completedAtUtc).toLocaleString()}` : ""}
                        </div>

                        {a.actorName ? (
                          <div className="text-xs text-muted-foreground">By: {a.actorName}</div>
                        ) : null}

                        {a.error ? (
                          <div className="text-xs text-red-600">{a.error}</div>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* Auto-Update Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Auto-Update Settings</CardTitle>
          <CardDescription>
            Configure automatic agent updates for this node
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AutoUpdateSettingsPanel nodeId={nodeId} />
        </CardContent>
      </Card>

      {/* System Update Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">System Update Settings</CardTitle>
          <CardDescription>
            Configure automatic operating system updates for this node
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SystemUpdateSettingsPanel nodeId={nodeId} />
        </CardContent>
      </Card>

      {/* System Update History */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">System Update History</CardTitle>
          <CardDescription>
            Recent system update history for this node
          </CardDescription>
        </CardHeader>
        <CardContent>
          <SystemUpdateHistoryPanel nodeId={nodeId} />
        </CardContent>
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
                <ScrollArea className="h-40">
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
              details={
                <div className="space-y-3">
                  {linkedMachine ? (
                    <div className="text-xs text-muted-foreground">
                      Linked machine: <span className="font-mono">{linkedMachine.username}@{linkedMachine.host}:{linkedMachine.port}</span>
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground">
                      No linked onboarding machine found for this node.
                    </div>
                  )}

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="delete-also-uninstall"
                      checked={deleteAlsoUninstall}
                      onCheckedChange={(v) => setDeleteAlsoUninstall(Boolean(v))}
                      disabled={!canUninstallFromMachine}
                    />
                    <label htmlFor="delete-also-uninstall" className="text-sm">
                      Also uninstall agent from the linked machine (via SSH)
                    </label>
                  </div>

                  {deleteAlsoUninstall && !linkedMachine ? (
                    <div className="text-xs text-muted-foreground">
                      (No linked machine available; SSH uninstall will be skipped.)
                    </div>
                  ) : null}

                  {!canUninstallFromMachine && linkedMachine ? (
                    <div className="text-xs text-muted-foreground">
                      To enable uninstall via SSH here, save credentials for this machine in Onboarding first.
                    </div>
                  ) : null}
                </div>
              }
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
