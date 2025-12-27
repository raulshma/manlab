import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Terminal } from "lucide-react";
import type { Command, CommandExecutionStatus } from "@/types";
import { fetchNodeCommands } from "@/api";

function statusVariant(
  status: CommandExecutionStatus
): "default" | "secondary" | "destructive" | "outline" {
  switch (status) {
    case "Success":
      return "default";
    case "Failed":
      return "destructive";
    case "InProgress":
      return "secondary";
    case "Queued":
      return "outline";
    default:
      return "outline";
  }
}

export function NodeCommandsPanel({ nodeId }: { nodeId: string }) {
  const {
    data: commands,
    isLoading,
    isError,
    error,
  } = useQuery({
    queryKey: ["commands", nodeId],
    queryFn: () => fetchNodeCommands(nodeId, 50),
    refetchInterval: (query) => {
      const data = query.state.data as Command[] | undefined;
      const hasRunning = data?.some(
        (c) => c.status === "Queued" || c.status === "InProgress"
      );
      return hasRunning ? 2000 : 10_000;
    },
  });

  const rows = useMemo(() => (commands ?? []).slice(0, 20), [commands]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Terminal className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-base">Commands</CardTitle>
        </div>
        <CardDescription>
          Recent command history and execution status
        </CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading && (
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Failed to load commands</AlertTitle>
            <AlertDescription>
              {error instanceof Error
                ? error.message
                : "Unknown error occurred"}
            </AlertDescription>
          </Alert>
        )}

        {!isLoading && !isError && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">No commands yet.</p>
        )}

        {!isLoading && !isError && rows.length > 0 && (
          <div className="space-y-2">
            {rows.map((c) => (
              <div
                key={c.id}
                className="flex flex-col gap-1 rounded-md border border-border bg-card px-3 py-2"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">
                      {c.commandType}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Created {new Date(c.createdAt).toLocaleString()}
                      {c.executedAt
                        ? ` · Executed ${new Date(
                            c.executedAt
                          ).toLocaleString()}`
                        : ""}
                    </div>
                  </div>
                  <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                </div>

                {c.outputLog && (
                  <pre className="mt-1 max-h-40 overflow-auto rounded bg-muted/30 p-2 text-xs">
                    {c.outputLog}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
