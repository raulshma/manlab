import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollText, Play, CheckCircle, XCircle, Clock, Activity } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { ScriptRun, ScriptRunStatus } from "@/types";
import { fetchNodes, fetchScriptRuns } from "@/api";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const ScriptRunsWidget = memo(function ScriptRunsWidget({ config, onConfigChange }: WidgetProps) {
  const nodeId = (config.nodeId as string) || "";
  const maxRuns = (config.maxRuns as number) ?? 5;

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
  });

  const { data: scriptRuns, isLoading } = useQuery({
    queryKey: ["scriptRuns", nodeId],
    queryFn: () => {
      if (!nodeId) return Promise.resolve(null);
      return fetchScriptRuns(nodeId, maxRuns * 2);
    },
    enabled: !!nodeId,
    staleTime: 30_000,
    refetchInterval: 30_000,
  });

  const selectedNode = nodes?.find((n) => n.id === nodeId);

  if (!nodeId) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <ScrollText className="h-4 w-4" />
          <span className="text-sm">Select a node to view recent script runs</span>
        </div>
        {nodes && nodes.length > 0 && (
          <Select
            value={nodeId}
            onValueChange={(value) => onConfigChange({ ...config, nodeId: value })}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Choose a node" />
            </SelectTrigger>
            <SelectContent>
              {nodes.map((n) => (
                <SelectItem key={n.id} value={n.id}>
                  {n.hostname}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-indigo-500" />
            Recent Scripts
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-8">
            <Activity className="h-6 w-6 text-muted-foreground/50 animate-spin" />
            <span className="ml-2 text-sm text-muted-foreground/70">Loading...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!scriptRuns || scriptRuns.length === 0) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg flex items-center gap-2">
            <ScrollText className="h-5 w-5 text-indigo-500" />
            Recent Scripts
          </CardTitle>
          {selectedNode && (
            <div className="text-sm text-muted-foreground/70">
              {selectedNode.hostname}
            </div>
          )}
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex flex-col items-center justify-center py-8 text-muted-foreground/70 space-y-2">
            <ScrollText className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-sm">No script runs yet</p>
            <p className="text-xs text-muted-foreground/50">Scripts executed on this node will appear here</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const recentRuns = scriptRuns.slice(0, maxRuns);
  const runningCount = recentRuns.filter((r) => r.status === "InProgress").length;
  const successCount = recentRuns.filter((r) => r.status === "Success").length;
  const failedCount = recentRuns.filter((r) => r.status === "Failed").length;

  return (
    <Card className="border">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg flex items-center gap-2">
              <ScrollText className="h-5 w-5 text-indigo-500" />
              Recent Scripts
            </CardTitle>
            {selectedNode && (
              <div className="text-sm text-muted-foreground/70">
                {selectedNode.hostname}
              </div>
            )}
          </div>
          <div className="flex items-center gap-1">
            {runningCount > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-blue-500/10 rounded text-xs text-blue-600">
                <Play className="h-3 w-3" />
                {runningCount}
              </div>
            )}
            <div className="flex items-center gap-1 px-2 py-0.5 bg-green-500/10 rounded text-xs text-green-600">
              <CheckCircle className="h-3 w-3" />
              {successCount}
            </div>
            {failedCount > 0 && (
              <div className="flex items-center gap-1 px-2 py-0.5 bg-red-500/10 rounded text-xs text-red-600">
                <XCircle className="h-3 w-3" />
                {failedCount}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="space-y-2">
          {recentRuns.map((run) => (
            <ScriptRunRow key={run.id} run={run} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
});

function formatDuration(start: string | null, end?: string | null): string {
  if (!start) return "N/A";
  if (!end) {
    const duration = new Date().getTime() - new Date(start).getTime();
    if (duration < 60000) return `${Math.floor(duration / 1000)}s`;
    return `${Math.floor(duration / 60000)}m`;
  }
  const duration = new Date(end).getTime() - new Date(start).getTime();
  if (duration < 60000) return `${Math.floor(duration / 1000)}s`;
  return `${Math.floor(duration / 60000)}m ${Math.floor((duration % 60000) / 1000)}s`;
}

function formatTime(date: string): string {
  const d = new Date(date);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  
  if (diff < 60000) return "just now";
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return d.toLocaleDateString();
}

function getStatusIcon(status: ScriptRunStatus) {
  switch (status) {
    case "InProgress":
      return <Play className="h-4 w-4 text-blue-500" />;
    case "Success":
      return <CheckCircle className="h-4 w-4 text-green-500" />;
    case "Failed":
      return <XCircle className="h-4 w-4 text-red-500" />;
    default:
      return <Clock className="h-4 w-4 text-muted-foreground" />;
  }
}

function getStatusClass(status: ScriptRunStatus): string {
  switch (status) {
    case "InProgress":
      return "border-blue-500/20 bg-blue-500/5";
    case "Success":
      return "border-green-500/20 bg-green-500/5";
    case "Failed":
      return "border-red-500/20 bg-red-500/5";
    default:
      return "border-muted/50 bg-muted/20";
  }
}

function ScriptRunRow({ run }: { run: ScriptRun }) {
  return (
    <div className={`flex items-center gap-3 p-2 rounded-lg border ${getStatusClass(run.status)}`}>
      <div className="flex-shrink-0">
        {getStatusIcon(run.status)}
      </div>
      
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">
          Script Run
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground/70 mt-0.5">
          <span>{run.startedAt ? formatTime(run.startedAt) : "Pending"}</span>
          {run.status === "InProgress" && (
            <span className="flex items-center gap-1 text-blue-600">
              <Activity className="h-3 w-3 animate-pulse" />
              Running
            </span>
          )}
          {run.finishedAt && run.startedAt && (
            <span>• {formatDuration(run.startedAt, run.finishedAt)}</span>
          )}
        </div>
      </div>

      <div className={`flex-shrink-0 px-2 py-0.5 rounded text-xs font-mono ${
        run.status === "Success" ? 'bg-green-500/10 text-green-600' : 
        run.status === "Failed" ? 'bg-red-500/10 text-red-600' :
        'bg-muted text-muted-foreground'
      }`}>
        {run.status}
      </div>
    </div>
  );
}
