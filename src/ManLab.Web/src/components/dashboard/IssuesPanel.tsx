import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, WifiOff, Cpu, CheckCircle2, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Node, Telemetry } from "@/types";

interface IssuesPanelProps {
  nodes: Node[];
  telemetry: Record<string, Telemetry | null>;
  isLoading?: boolean;
}

interface IssueItem {
  nodeId: string;
  hostname: string;
  type: "error" | "offline" | "highLoad";
  message: string;
  detail?: string;
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

/**
 * Issues and alerts panel for the dashboard.
 * Shows nodes with errors, offline status, or high resource usage.
 */
export function IssuesPanel({ nodes, telemetry, isLoading }: IssuesPanelProps) {
  // Collect all issues
  const issues: IssueItem[] = [];

  for (const node of nodes) {
    // Error state nodes
    if (node.status === "Error") {
      issues.push({
        nodeId: node.id,
        hostname: node.hostname,
        type: "error",
        message: node.errorMessage || "Unknown error",
        detail: node.errorCode ? `Error ${node.errorCode}` : undefined,
      });
    }
    // Offline nodes
    else if (node.status === "Offline") {
      issues.push({
        nodeId: node.id,
        hostname: node.hostname,
        type: "offline",
        message: "Node is offline",
        detail: `Last seen ${formatRelativeTime(node.lastSeen)}`,
      });
    }
    // High CPU load
    else {
      const t = telemetry[node.id];
      if (t && t.cpuUsage >= 80) {
        issues.push({
          nodeId: node.id,
          hostname: node.hostname,
          type: "highLoad",
          message: `CPU at ${t.cpuUsage.toFixed(1)}%`,
          detail: "High load detected",
        });
      }
    }
  }

  // Sort by severity: error > offline > highLoad
  const priority = { error: 0, offline: 1, highLoad: 2 };
  issues.sort((a, b) => priority[a.type] - priority[b.type]);

  if (isLoading) {
    return (
      <Card className="border shadow-sm">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            Issues & Alerts
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-12 bg-muted/50 rounded-lg animate-pulse" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
            Issues & Alerts
          </CardTitle>
          {issues.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {issues.length} issue{issues.length !== 1 ? "s" : ""}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pt-0">
        {issues.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <div className="p-3 rounded-full bg-emerald-500/10 mb-3">
              <CheckCircle2 className="h-6 w-6 text-emerald-500" />
            </div>
            <p className="text-sm font-medium text-foreground">All Clear</p>
            <p className="text-xs text-muted-foreground mt-1">
              No issues detected across your fleet
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[280px] pr-4">
            <div className="space-y-2">
              {issues.map((issue) => (
                <Link
                  key={`${issue.nodeId}-${issue.type}`}
                  to={`/nodes/${issue.nodeId}`}
                  className="block"
                >
                  <div
                    className={cn(
                      "flex items-start gap-3 p-3 rounded-lg border transition-all",
                      "hover:bg-muted/50 hover:border-muted-foreground/20",
                      issue.type === "error" && "border-destructive/20 bg-destructive/5",
                      issue.type === "offline" && "border-rose-500/20 bg-rose-500/5",
                      issue.type === "highLoad" && "border-amber-500/20 bg-amber-500/5"
                    )}
                  >
                    <div
                      className={cn(
                        "p-1.5 rounded-full shrink-0 mt-0.5",
                        issue.type === "error" && "bg-destructive/10 text-destructive",
                        issue.type === "offline" && "bg-rose-500/10 text-rose-500",
                        issue.type === "highLoad" && "bg-amber-500/10 text-amber-500"
                      )}
                    >
                      {issue.type === "error" && <AlertTriangle className="h-3.5 w-3.5" />}
                      {issue.type === "offline" && <WifiOff className="h-3.5 w-3.5" />}
                      {issue.type === "highLoad" && <Cpu className="h-3.5 w-3.5" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Server className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium truncate">
                          {issue.hostname}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {issue.message}
                      </p>
                      {issue.detail && (
                        <p className="text-xs text-muted-foreground/70 mt-0.5">
                          {issue.detail}
                        </p>
                      )}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
