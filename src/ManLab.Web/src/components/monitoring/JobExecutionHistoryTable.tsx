import { useQuery } from "@tanstack/react-query";
import { Loader2, CheckCircle, XCircle, Clock } from "lucide-react";
import { fetchJobHistory } from "@/api";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

interface JobExecutionHistoryTableProps {
  jobId: string;
  jobType: string;
}

export function JobExecutionHistoryTable({ jobId, jobType }: JobExecutionHistoryTableProps) {
  const { data: history, isLoading, error } = useQuery({
    queryKey: ["job-history", jobId, jobType],
    queryFn: () => fetchJobHistory(jobId, jobType),
    refetchInterval: 30000,
  });

  if (isLoading) {
    return (
      <div className="flex h-20 items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 text-sm text-red-500">
        Failed to load history: {(error as Error).message}
      </div>
    );
  }

  if (!history || history.length === 0) {
    return (
      <div className="p-4 text-sm text-muted-foreground">
        No execution history available.
      </div>
    );
  }

  return (
    <div className="rounded-md border bg-card">
      <ScrollArea className="h-[300px]">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[180px]">Time</TableHead>
              <TableHead className="w-[100px]">Status</TableHead>
              <TableHead className="w-[100px]">Duration</TableHead>
              <TableHead>Message / Details</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((run, i) => (
              <TableRow key={i}>
                <TableCell className="font-mono text-xs">
                  {new Date(run.timestampUtc).toLocaleString()}
                </TableCell>
                <TableCell>
                  {run.success ? (
                    <Badge variant="outline" className="gap-1 border-green-500/30 text-green-500">
                      <CheckCircle className="h-3 w-3" />
                      Success
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="gap-1 border-red-500/30 text-red-500">
                      <XCircle className="h-3 w-3" />
                      Failed
                    </Badge>
                  )}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    {run.durationMs}ms
                  </div>
                </TableCell>
                <TableCell className="max-w-[400px]">
                  <div className="flex flex-col gap-1">
                    <span className="text-sm truncate" title={run.message || ""}>
                      {run.message}
                    </span>
                    {run.detailsJson && (
                      <code className="text-xs text-muted-foreground truncate bg-muted/50 p-1 rounded font-mono">
                        {run.detailsJson}
                      </code>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
