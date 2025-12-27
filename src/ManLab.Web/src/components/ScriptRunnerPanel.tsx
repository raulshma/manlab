/**
 * ScriptRunnerPanel - Execute scripts on nodes and view run history.
 * Shows script selector, run button, and history with output tails.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  fetchScripts,
  fetchScriptRuns,
  createScriptRun,
  cancelScriptRun,
} from "../api";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertCircle,
  Play,
  Terminal,
  ChevronDown,
  ChevronRight,
  Clock,
  CheckCircle2,
  XCircle,
  Loader2,
} from "lucide-react";

interface ScriptRunnerPanelProps {
  nodeId: string;
  nodeStatus?: string;
}

// Helper to format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  const diffMinutes = Math.floor(diffSeconds / 60);
  const diffHours = Math.floor(diffMinutes / 60);

  if (diffSeconds < 60) return "Just now";
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${Math.floor(diffHours / 24)}d ago`;
}

// Get status badge variant
function getStatusBadgeVariant(
  status: string
): "default" | "destructive" | "secondary" | "outline" {
  switch (status) {
    case "Success":
      return "default";
    case "Failed":
    case "Cancelled":
      return "destructive";
    case "InProgress":
    case "Sent":
      return "secondary";
    default:
      return "outline";
  }
}

// Get status icon
function getStatusIcon(status: string) {
  switch (status) {
    case "Success":
      return <CheckCircle2 className="h-4 w-4 text-green-500" />;
    case "Failed":
    case "Cancelled":
      return <XCircle className="h-4 w-4 text-destructive" />;
    case "InProgress":
    case "Sent":
      return <Loader2 className="h-4 w-4 animate-spin" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

export function ScriptRunnerPanel({
  nodeId,
  nodeStatus = "Online",
}: ScriptRunnerPanelProps) {
  const queryClient = useQueryClient();
  const [selectedScriptId, setSelectedScriptId] = useState<string>("");
  const [expandedRuns, setExpandedRuns] = useState<Set<string>>(new Set());

  // Fetch scripts list
  const { data: scripts, isLoading: scriptsLoading } = useQuery({
    queryKey: ["scripts"],
    queryFn: fetchScripts,
  });

  // Fetch script runs for this node
  const { data: runs, isLoading: runsLoading } = useQuery({
    queryKey: ["scriptRuns", nodeId],
    queryFn: () => fetchScriptRuns(nodeId, 20),
    refetchInterval: 5000,
  });

  // Create script run mutation
  const runMutation = useMutation({
    mutationFn: () => createScriptRun(nodeId, selectedScriptId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scriptRuns", nodeId] });
    },
  });

  // Cancel script run mutation
  const cancelMutation = useMutation({
    mutationFn: (runId: string) => cancelScriptRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scriptRuns", nodeId] });
    },
  });

  const toggleExpand = (runId: string) => {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(runId)) {
        next.delete(runId);
      } else {
        next.add(runId);
      }
      return next;
    });
  };

  const getScriptName = (scriptId: string): string => {
    const script = scripts?.find((s) => s.id === scriptId);
    return script?.name ?? "Unknown Script";
  };

  const handleRun = () => {
    if (selectedScriptId) {
      runMutation.mutate();
    }
  };

  const isOnline = nodeStatus === "Online";

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Terminal className="h-5 w-5 text-muted-foreground" />
          <div>
            <CardTitle className="text-base">Script Runner</CardTitle>
            <CardDescription>
              Execute scripts from the library on this node
            </CardDescription>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Script Selector and Run Button */}
        <div className="flex items-center gap-2 mb-6">
          <Select value={selectedScriptId} onValueChange={(v) => setSelectedScriptId(v ?? "")}>
            <SelectTrigger className="flex-1">
              <SelectValue>
                {selectedScriptId
                  ? scripts?.find((s) => s.id === selectedScriptId)?.name ?? "Select a script..."
                  : "Select a script..."}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {scripts?.map((script) => (
                <SelectItem key={script.id} value={script.id}>
                  <div className="flex items-center gap-2">
                    <Terminal className="h-3 w-3" />
                    {script.name}
                    <Badge variant="outline" className="ml-2 text-xs">
                      {script.shell}
                    </Badge>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            onClick={handleRun}
            disabled={!selectedScriptId || !isOnline || runMutation.isPending}
          >
            {runMutation.isPending ? (
              <Spinner className="h-4 w-4 mr-2" />
            ) : (
              <Play className="h-4 w-4 mr-2" />
            )}
            Run
          </Button>
        </div>

        {runMutation.isError && (
          <Alert variant="destructive" className="mb-4">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>
              {runMutation.error instanceof Error
                ? runMutation.error.message
                : "Failed to run script"}
            </AlertDescription>
          </Alert>
        )}

        {runMutation.isSuccess && (
          <Alert className="mb-4">
            <CheckCircle2 className="h-4 w-4" />
            <AlertDescription>Script execution queued successfully.</AlertDescription>
          </Alert>
        )}

        {/* Scripts link hint */}
        {(!scripts || scripts.length === 0) && !scriptsLoading && (
          <Alert className="mb-4">
            <AlertDescription>
              No scripts available. Go to Settings &gt; Scripts to create scripts.
            </AlertDescription>
          </Alert>
        )}

        {/* Run History */}
        <div>
          <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Recent Runs
          </h4>

          {runsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner className="h-6 w-6" />
            </div>
          ) : !runs || runs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Terminal className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p>No script runs yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {runs.map((run) => (
                <Collapsible
                  key={run.id}
                  open={expandedRuns.has(run.id)}
                  onOpenChange={() => toggleExpand(run.id)}
                >
                  <div className="border rounded-lg">
                    <CollapsibleTrigger className="w-full p-3 flex items-center justify-between hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                        {expandedRuns.has(run.id) ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                        {getStatusIcon(run.status)}
                        <span className="font-medium">
                          {getScriptName(run.scriptId)}
                        </span>
                        <Badge variant={getStatusBadgeVariant(run.status)}>
                          {run.status}
                        </Badge>
                      </div>
                      <span className="text-xs text-muted-foreground mr-2">
                        {formatRelativeTime(run.createdAt)}
                      </span>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="px-3 pb-3 pt-0 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="grid grid-cols-2 gap-2 text-xs">
                            <div>
                              <span className="text-muted-foreground">Started:</span>{" "}
                              {run.startedAt
                                ? new Date(run.startedAt).toLocaleString()
                                : "Pending"}
                            </div>
                            <div>
                              <span className="text-muted-foreground">Finished:</span>{" "}
                              {run.finishedAt
                                ? new Date(run.finishedAt).toLocaleString()
                                : "Not yet"}
                            </div>
                          </div>
                          {(run.status === "InProgress" || run.status === "Sent" || run.status === "Queued") && (
                            <Button
                              variant="destructive"
                              size="sm"
                              className="h-6 text-xs"
                              onClick={() => cancelMutation.mutate(run.id)}
                              disabled={cancelMutation.isPending}
                            >
                              Cancel
                            </Button>
                          )}
                        </div>
                        {(run.stdoutTail || run.stderrTail) && (
                          <div className="space-y-2">
                            {run.stdoutTail && (
                              <div>
                                <div className="text-xs font-medium text-muted-foreground mb-1">
                                  stdout:
                                </div>
                                <pre className="bg-muted p-2 rounded text-xs font-mono whitespace-pre-wrap max-h-32 overflow-auto">
                                  {run.stdoutTail}
                                </pre>
                              </div>
                            )}
                            {run.stderrTail && (
                              <div>
                                <div className="text-xs font-medium text-destructive mb-1">
                                  stderr:
                                </div>
                                <pre className="bg-destructive/10 p-2 rounded text-xs font-mono whitespace-pre-wrap max-h-32 overflow-auto text-destructive">
                                  {run.stderrTail}
                                </pre>
                              </div>
                            )}
                          </div>
                        )}
                        {run.requestedBy && (
                          <div className="text-xs text-muted-foreground">
                            Requested by: {run.requestedBy}
                          </div>
                        )}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              ))}
            </div>
          )}
        </div>

        {!isOnline && (
          <p className="text-xs text-muted-foreground mt-4">
            ⚠️ Script execution is only available when the node is online.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
