/**
 * LocalAgentCard component for managing the local agent installation on the server.
 * Provides install/uninstall buttons and shows real-time logs.
 */

import { useState, useEffect, useRef, type ReactNode, useCallback } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  fetchLocalAgentStatus,
  fetchDefaultAgentConfig,
  installLocalAgent,
  uninstallLocalAgent,
  clearLocalAgentFiles,
  deleteNode,
} from "../api";
import { useSignalR } from "../SignalRContext";
import type { LocalAgentStatus, AgentConfiguration, FileDirectoryInfo, TaskInfo } from "../types";
import { ConfirmationModal } from "./ConfirmationModal";
import { ChevronRight, Server, Shield, User, Trash2, AlertTriangle, Settings } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";

const LOCAL_MACHINE_ID = "00000000-0000-0000-0000-000000000001";

export function LocalAgentCard() {
  const queryClient = useQueryClient();
  const { localAgentLogs, subscribeToLocalAgentLogs } = useSignalR();
  // Collapsed by default on initial page load.
  const [isExpanded, setIsExpanded] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showOrphanedDetails, setShowOrphanedDetails] = useState(false);
  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const logsContainerRef = useRef<HTMLDivElement>(null);
  const [isFollowingLogs, setIsFollowingLogs] = useState(true);

  // Agent configuration state
  const [heartbeatInterval, setHeartbeatInterval] = useState<number>(10);
  const [maxReconnectDelay, setMaxReconnectDelay] = useState<number>(120);

  const {
    data: status,
    isLoading,
    error,
  } = useQuery<LocalAgentStatus>({
    queryKey: ["localAgentStatus"],
    queryFn: fetchLocalAgentStatus,
    refetchInterval: 5000,
  });

  // Fetch default agent configuration
  const { data: defaultConfig } = useQuery<AgentConfiguration>({
    queryKey: ["defaultAgentConfig"],
    queryFn: fetchDefaultAgentConfig,
  });

  // Use default config values when available, otherwise use initial state
  const effectiveHeartbeatInterval = heartbeatInterval === 10 && defaultConfig 
    ? defaultConfig.heartbeatIntervalSeconds 
    : heartbeatInterval;
  const effectiveMaxReconnectDelay = maxReconnectDelay === 120 && defaultConfig 
    ? defaultConfig.maxReconnectDelaySeconds 
    : maxReconnectDelay;

  // Filter logs for local machine
  const filteredLogs = localAgentLogs
    .filter((log) => log.machineId === LOCAL_MACHINE_ID)
    .map((log) => ({ timestamp: log.timestamp, message: log.message }));

  // Auto-show logs when new local agent logs arrive
  useEffect(() => {
    const unsubscribe = subscribeToLocalAgentLogs((log) => {
      if (log.machineId === LOCAL_MACHINE_ID) {
        setShowLogs(true);
        setIsFollowingLogs(true);
      }
    });
    return unsubscribe;
  }, [subscribeToLocalAgentLogs]);

  // Auto-scroll logs ("follow tail") while the user hasn't scrolled up.
  useEffect(() => {
    if (!showLogs || !isFollowingLogs) return;
    const el = logsContainerRef.current;
    if (!el) return;

    const raf = requestAnimationFrame(() => {
      // Keep the scroll pinned to the bottom as new log lines arrive.
      el.scrollTop = el.scrollHeight;
    });

    return () => cancelAnimationFrame(raf);
  }, [filteredLogs.length, showLogs, isFollowingLogs]);

  const installMutation = useMutation({
    mutationFn: ({ force, userMode }: { force: boolean; userMode: boolean }) => {
      // Build config object only if values differ from defaults
      const agentConfig = showAdvancedSettings ? {
        heartbeatIntervalSeconds: effectiveHeartbeatInterval,
        maxReconnectDelaySeconds: effectiveMaxReconnectDelay,
      } : undefined;
      return installLocalAgent(force, userMode, agentConfig);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["localAgentStatus"] });
    },
  });

  const uninstallMutation = useMutation({
    mutationFn: () => uninstallLocalAgent(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["localAgentStatus"] });
    },
  });

  const clearFilesMutation = useMutation({
    mutationFn: () => clearLocalAgentFiles(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["localAgentStatus"] });
    },
  });

  const pendingUninstallRef = useRef(false);
  const pendingUninstallLinkedNodeIdRef = useRef<string | null>(null);
  const prevInstalledRef = useRef<boolean | null>(null);

  const [removeNodePrompt, setRemoveNodePrompt] = useState<{ open: boolean; nodeId: string | null }>({ open: false, nodeId: null });

  const closeRemoveNodePrompt = useCallback(() => {
    setRemoveNodePrompt({ open: false, nodeId: null });
  }, []);

  const deleteLinkedNodeMutation = useMutation({
    mutationFn: async (nodeId: string) => {
      await deleteNode(nodeId);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["nodes"] });
      await queryClient.invalidateQueries({ queryKey: ["localAgentStatus"] });
      toast.success("Node removed");
      closeRemoveNodePrompt();
    },
    onError: (err) => {
      toast.error("Failed to delete node", {
        description: err instanceof Error ? err.message : "Unknown error",
      });
    },
  });

  // When a local uninstall we started completes successfully, prompt to delete the linked node.
  // We defer the state update via queueMicrotask to avoid synchronous setState in effect body.
  useEffect(() => {
    if (!status) return;

    if (prevInstalledRef.current === null) {
      prevInstalledRef.current = status.isInstalled;
      return;
    }

    const wasInstalled = prevInstalledRef.current;
    const isInstalled = status.isInstalled;

    // Consider "uninstall finished" when the server reports not installed and no operation is running.
    const uninstallFinished = wasInstalled === true && isInstalled === false && status.currentOperation == null;

    if (pendingUninstallRef.current && uninstallFinished) {
      pendingUninstallRef.current = false;
      const nodeId = pendingUninstallLinkedNodeIdRef.current ?? status.linkedNodeId;
      pendingUninstallLinkedNodeIdRef.current = null;

      if (nodeId) {
        queueMicrotask(() => {
          setRemoveNodePrompt({ open: true, nodeId });
        });
      }
    }

    prevInstalledRef.current = status.isInstalled;
  }, [status]);

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="animate-pulse flex items-center gap-3">
            <div className="w-8 h-8 bg-muted rounded-full"></div>
            <div className="h-4 bg-muted rounded w-32"></div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertDescription>Failed to load local agent status</AlertDescription>
      </Alert>
    );
  }

  if (!status?.isSupported) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-center gap-3 text-muted-foreground">
            <svg
              className="w-6 h-6"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              />
            </svg>
            <span className="text-sm">
              Local agent not supported on this platform
            </span>
          </div>
        </CardContent>
      </Card>
    );
  }

  const isOperationRunning = status.currentOperation != null;
  const statusVariant = status.isRunning
    ? "default"
    : status.isInstalled
    ? "secondary"
    : "outline";
  
  // Check if there are orphaned resources (files or tasks exist but agent is not properly installed)
  const hasOrphanedResources = !status.isInstalled && 
    (status.hasSystemFiles || status.hasUserFiles || status.hasSystemTask || status.hasUserTask);
  const orphaned = status.orphanedResources;
  
  // Format bytes to human readable
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const cleanupPreviewDetails = (() => {
    const sections: Array<{ label: string; lines: ReactNode[] }> = [];

    const addDir = (label: string, dir: FileDirectoryInfo) => {
      const summary = `${dir.path} (${formatBytes(dir.totalSizeBytes)}, ${dir.fileCount} files)`;
      const fileLines = (dir.files ?? []).map((f) => (
        <li key={f} className="truncate" title={f}>
          {f}
        </li>
      ));

      sections.push({
        label,
        lines: [
          <div key="summary" className="font-mono text-xs break-all">{summary}</div>,
          ...(fileLines.length > 0
            ? [
                <div key="files" className="mt-1">
                  <div className="text-xs font-medium">Files (sample)</div>
                  <ul className="mt-1 list-disc pl-5 text-xs font-mono text-muted-foreground">
                    {fileLines}
                  </ul>
                </div>,
              ]
            : []),
        ],
      });
    };

    const addTask = (label: string, task: TaskInfo) => {
      const details = `${task.name} (state: ${task.state})`;
      const lines: ReactNode[] = [
        <div key="task" className="font-mono text-xs break-all">{details}</div>,
      ];
      if (task.lastRunTime) {
        lines.push(
          <div key="last" className="text-xs text-muted-foreground">Last run: {task.lastRunTime}</div>
        );
      }
      sections.push({
        label,
        lines,
      });
    };

    if (orphaned?.systemDirectory) addDir("System files", orphaned.systemDirectory);
    if (orphaned?.userDirectory) addDir("User files", orphaned.userDirectory);
    if (orphaned?.systemTask) addTask("System scheduled task", orphaned.systemTask);
    if (orphaned?.userTask) addTask("User scheduled task", orphaned.userTask);

    // Best-effort: the uninstaller also attempts to remove legacy service installs.
    sections.push({
      label: "Services",
      lines: [
        <div key="svc" className="text-xs text-muted-foreground">
          Legacy Windows service (if present): <span className="font-mono">manlab-agent</span>
        </div>,
      ],
    });

    if (sections.length === 0) return null;

    return (
      <div className="space-y-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Cleanup preview (best-effort)
        </div>
        <div className="text-xs text-muted-foreground">
          These resources are expected to be removed. If something can’t be detected, the uninstall still attempts cleanup.
        </div>
        <div className="space-y-2">
          {sections.map((s) => (
            <div key={s.label}>
              <div className="text-xs font-medium">{s.label}</div>
              <div className="mt-1 space-y-1">{s.lines}</div>
            </div>
          ))}
        </div>
      </div>
    );
  })();

  return (
    <Card>
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CardHeader>
          <CollapsibleTrigger className="w-full text-left">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-center gap-3">
                <Server className="h-5 w-5 text-muted-foreground" />
                <div>
                  <CardTitle>Local Server Agent</CardTitle>
                  <CardDescription>Monitor this server machine</CardDescription>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Badge variant={statusVariant}>{status.status}</Badge>
                <ChevronRight
                  className={`h-4 w-4 text-muted-foreground transition-transform ${
                    isExpanded ? "rotate-90" : ""
                  }`}
                />
              </div>
            </div>
          </CollapsibleTrigger>
        </CardHeader>

        <CollapsibleContent>
          <CardContent className="space-y-4">
        {/* Orphaned Resources Warning */}
        {hasOrphanedResources && (
          <div className="space-y-3">
            <Alert>
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span>Leftover agent resources detected</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2"
                    onClick={() => setShowOrphanedDetails(!showOrphanedDetails)}
                  >
                    <ChevronRight
                      className={`h-3 w-3 transition-transform ${showOrphanedDetails ? "rotate-90" : ""}`}
                    />
                    {showOrphanedDetails ? "Hide" : "Details"}
                  </Button>
                </div>
                <ConfirmationModal
                  title="Clear Agent Resources"
                  message="This will remove all leftover agent files, configuration, and scheduled tasks. This action cannot be undone."
                  details={cleanupPreviewDetails}
                  confirmText="Clear All"
                  isDestructive={true}
                  isLoading={clearFilesMutation.isPending}
                  onConfirm={() => clearFilesMutation.mutate()}
                  trigger={
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={isOperationRunning || clearFilesMutation.isPending}
                    >
                      <Trash2 className="h-4 w-4 mr-1" />
                      {clearFilesMutation.isPending ? "Clearing..." : "Clear"}
                    </Button>
                  }
                />
              </AlertDescription>
            </Alert>

            {/* Expandable Details */}
            {showOrphanedDetails && orphaned && (
              <Card>
                <CardContent className="py-3 space-y-3 text-sm">
                  {/* System Directory */}
                  {orphaned.systemDirectory && (
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <Shield className="h-3 w-3" />
                        System Files
                      </div>
                      <div className="text-muted-foreground ml-5">
                        <div>{formatBytes(orphaned.systemDirectory.totalSizeBytes)} ({orphaned.systemDirectory.fileCount} files)</div>
                        <div className="font-mono text-xs truncate">{orphaned.systemDirectory.path}</div>
                      </div>
                    </div>
                  )}

                  {/* User Directory */}
                  {orphaned.userDirectory && (
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <User className="h-3 w-3" />
                        User Files
                      </div>
                      <div className="text-muted-foreground ml-5">
                        <div>{formatBytes(orphaned.userDirectory.totalSizeBytes)} ({orphaned.userDirectory.fileCount} files)</div>
                        <div className="font-mono text-xs truncate">{orphaned.userDirectory.path}</div>
                      </div>
                    </div>
                  )}

                  {/* System Task */}
                  {orphaned.systemTask && (
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <Shield className="h-3 w-3" />
                        System Scheduled Task
                      </div>
                      <div className="text-muted-foreground ml-5">
                        <div>State: {orphaned.systemTask.state}</div>
                        {orphaned.systemTask.lastRunTime && (
                          <div className="text-xs">Last run: {orphaned.systemTask.lastRunTime}</div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* User Task */}
                  {orphaned.userTask && (
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        <User className="h-3 w-3" />
                        User Scheduled Task
                      </div>
                      <div className="text-muted-foreground ml-5">
                        <div>State: {orphaned.userTask.state}</div>
                        {orphaned.userTask.lastRunTime && (
                          <div className="text-xs">Last run: {orphaned.userTask.lastRunTime}</div>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Advanced Settings - only show when not installed */}
        {!status.isInstalled && (
          <div className="space-y-3">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvancedSettings(!showAdvancedSettings)}
              className="w-fit"
            >
              <Settings className="h-4 w-4 mr-2" />
              <ChevronRight
                className={`h-4 w-4 transition-transform ${
                  showAdvancedSettings ? "rotate-90" : ""
                }`}
              />
              Advanced Settings
            </Button>

            {showAdvancedSettings && (
              <Card>
                <CardContent className="py-3 space-y-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="heartbeatInterval">
                        Heartbeat Interval (seconds)
                      </Label>
                      <Input
                        id="heartbeatInterval"
                        type="number"
                        min={1}
                        max={300}
                        value={heartbeatInterval}
                        onChange={(e) =>
                          setHeartbeatInterval(parseInt(e.target.value) || 10)
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        How often the agent sends telemetry data
                      </p>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="maxReconnectDelay">
                        Max Reconnect Delay (seconds)
                      </Label>
                      <Input
                        id="maxReconnectDelay"
                        type="number"
                        min={10}
                        max={600}
                        value={maxReconnectDelay}
                        onChange={(e) =>
                          setMaxReconnectDelay(parseInt(e.target.value) || 120)
                        }
                      />
                      <p className="text-xs text-muted-foreground">
                        Maximum delay between reconnection attempts
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {/* Actions */}
        <div className="flex flex-wrap gap-2">
          {!status.isInstalled && (
            <>
              {/* System Mode Install (requires admin) */}
              <ConfirmationModal
                title="Install Local Agent (System Mode)"
                message="This will install the ManLab agent system-wide, requiring administrator privileges. The agent will run as SYSTEM at startup and persist across all users."
                confirmText="Install (Admin)"
                onConfirm={() => installMutation.mutate({ force: false, userMode: false })}
                trigger={
                  <Button
                    variant="default"
                    className="flex-1"
                    disabled={isOperationRunning || installMutation.isPending}
                  >
                    <Shield className="h-4 w-4 mr-2" />
                    {installMutation.isPending ? "Installing..." : "System Install"}
                  </Button>
                }
              />
              {/* User Mode Install (no admin required) */}
              <ConfirmationModal
                title="Install Local Agent (User Mode)"
                message="This will install the ManLab agent to your local user directory. No administrator privileges required. The agent will run when you log in."
                confirmText="Install (User)"
                onConfirm={() => installMutation.mutate({ force: false, userMode: true })}
                trigger={
                  <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={isOperationRunning || installMutation.isPending}
                  >
                    <User className="h-4 w-4 mr-2" />
                    {installMutation.isPending ? "Installing..." : "User Install"}
                  </Button>
                }
              />
            </>
          )}

          {status.isInstalled && (
            <>
              <ConfirmationModal
                title={`Reinstall Local Agent (${status.installMode} Mode)`}
                message={`This will reinstall the ManLab agent in ${status.installMode} mode, replacing any existing installation. The agent configuration will be reset.`}
                confirmText="Reinstall"
                onConfirm={() =>
                  installMutation.mutate({
                    force: true,
                    userMode: status.installMode === "User",
                  })
                }
                trigger={
                  <Button
                    variant="secondary"
                    className="flex-1"
                    disabled={isOperationRunning || installMutation.isPending}
                  >
                    Reinstall
                  </Button>
                }
              />
              <ConfirmationModal
                title="Uninstall Local Agent"
                message="This will remove the ManLab agent from this server. You will no longer be able to monitor this machine until you reinstall the agent."
                details={cleanupPreviewDetails}
                confirmText="Uninstall"
                isDestructive={true}
                isLoading={uninstallMutation.isPending}
                onConfirm={() => {
                  pendingUninstallRef.current = true;
                  pendingUninstallLinkedNodeIdRef.current = status.linkedNodeId;
                  uninstallMutation.mutate();
                }}
                trigger={
                  <Button
                    variant="destructive"
                    className="flex-1"
                    disabled={isOperationRunning || uninstallMutation.isPending}
                  >
                    {uninstallMutation.isPending ? "Removing..." : "Uninstall"}
                  </Button>
                }
              />
            </>
          )}
        </div>

        {/* Linked Node */}
        {status.linkedNodeId && (
          <div className="space-x-2 text-sm">
            <span className="text-muted-foreground">Linked node:</span>
            <a
              href={`/nodes/${status.linkedNodeId}`}
              className="font-mono underline underline-offset-4"
            >
              {status.linkedNodeId.substring(0, 8)}...
            </a>
          </div>
        )}

        {/* Logs Toggle */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const next = !showLogs;
            setShowLogs(next);
            if (next) setIsFollowingLogs(true);
          }}
          className="w-fit"
        >
          <ChevronRight
            className={`h-4 w-4 transition-transform ${
              showLogs ? "rotate-90" : ""
            }`}
          />
          {showLogs ? "Hide" : "Show"} installation logs ({filteredLogs.length})
        </Button>

        {/* Logs */}
        {showLogs && filteredLogs.length > 0 && (
          <Card>
            <CardContent
              ref={logsContainerRef}
              className="max-h-48 overflow-y-auto py-3 font-mono text-xs"
              onScroll={() => {
                const el = logsContainerRef.current;
                if (!el) return;
                // Consider the user "following" if they're close to the bottom.
                const thresholdPx = 24;
                const distanceFromBottom =
                  el.scrollHeight - el.scrollTop - el.clientHeight;
                setIsFollowingLogs(distanceFromBottom <= thresholdPx);
              }}
            >
              {filteredLogs.map((log, i) => (
                <div
                  key={i}
                  className={
                    log.message.includes("ERROR")
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }
                >
                  <span className="text-muted-foreground/70">
                    {new Date(log.timestamp).toLocaleTimeString()}
                  </span>{" "}
                  {log.message}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Error Display */}
        {(installMutation.error || uninstallMutation.error || clearFilesMutation.error) && (
          <Alert variant="destructive">
            <AlertDescription>
              {installMutation.error?.message ||
                uninstallMutation.error?.message ||
                clearFilesMutation.error?.message}
            </AlertDescription>
          </Alert>
        )}
          </CardContent>
        </CollapsibleContent>
      </Collapsible>

      <AlertDialog open={removeNodePrompt.open} onOpenChange={(open) => !open && closeRemoveNodePrompt()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove the node too?</AlertDialogTitle>
            <AlertDialogDescription>
              The local agent uninstall completed successfully.
              {removeNodePrompt.nodeId ? (
                <>
                  <br />
                  Do you also want to remove the associated node for this server?
                  This deletes telemetry, settings, and command history.
                </>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteLinkedNodeMutation.isPending}>Keep Node</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (!removeNodePrompt.nodeId) return;
                deleteLinkedNodeMutation.mutate(removeNodePrompt.nodeId);
              }}
              disabled={!removeNodePrompt.nodeId || deleteLinkedNodeMutation.isPending}
              variant="destructive"
            >
              {deleteLinkedNodeMutation.isPending ? "Removing…" : "Remove Node"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
