import { useMemo } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { fetchNodes } from "@/api";
import type { Node } from "@/types";

import { LogViewerPanel } from "@/components/LogViewerPanel";
import { Button } from "@/components/ui/button";
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
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertCircle, ExternalLink, FileText } from "lucide-react";

export function LogViewerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedNodeId = searchParams.get("node") ?? "";

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

  const selectedNode = useMemo(() => {
    if (!nodes || !selectedNodeId) return null;
    return nodes.find((n) => n.id === selectedNodeId) ?? null;
  }, [nodes, selectedNodeId]);

  const setNodeId = (nodeId: string) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      if (!nodeId) {
        next.delete("node");
      } else {
        next.set("node", nodeId);
      }
      return next;
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <CardTitle>Log Viewer</CardTitle>
          </div>
          <CardDescription>
            View and follow remote logs (policy-based, session-scoped)
          </CardDescription>
        </div>

        <div className="flex items-center gap-2">
          {isLoading ? (
            <Skeleton className="h-10 w-64" />
          ) : (
            <Select value={selectedNodeId} onValueChange={(v) => setNodeId(v ?? "")}>
              <SelectTrigger className="w-72">
                <SelectValue>
                  {selectedNode
                    ? `${selectedNode.hostname} (${selectedNode.status})`
                    : "Select a node…"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {(nodes ?? []).map((n: Node) => (
                  <SelectItem key={n.id} value={n.id}>
                    {n.hostname} ({n.status})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          <Button
            variant="outline"
            disabled={!selectedNodeId}
            onClick={() => navigate(`/nodes/${selectedNodeId}`)}
          >
            <ExternalLink className="h-4 w-4 mr-1" />
            Node details
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Failed to load nodes</AlertTitle>
            <AlertDescription>
              {error instanceof Error ? error.message : "Unknown error occurred"}
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !isError && !selectedNodeId && (
          <div className="rounded-lg border bg-muted/30 p-6 text-sm text-muted-foreground">
            Pick a node to start viewing logs. Policies and sessions are managed per-node.
          </div>
        )}

        {selectedNodeId && (
          <LogViewerPanel
            key={selectedNodeId}
            nodeId={selectedNodeId}
            nodeStatus={selectedNode?.status ?? "Offline"}
            variant="page"
          />
        )}
      </CardContent>
    </Card>
  );
}
