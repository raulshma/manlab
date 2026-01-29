import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { RefreshCw, Clock, CheckCircle, XCircle, Activity, Loader2 } from "lucide-react";
import { fetchGlobalJobHistory, fetchRunningJobs } from "@/api";

function formatDuration(ms: number) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

export function MonitoringHistoryPanel() {
  const [historyCount, setHistoryCount] = useState(50);

  const { data: runningJobs, isLoading: isLoadingRunning, refetch: refetchRunning } = useQuery({
    queryKey: ["monitoring", "jobs", "running"],
    queryFn: fetchRunningJobs,
    refetchInterval: 5000,
  });

  const { data: history, isLoading: isLoadingHistory, refetch: refetchHistory, isFetching: isFetchingHistory } = useQuery({
    queryKey: ["monitoring", "jobs", "history", historyCount],
    queryFn: () => fetchGlobalJobHistory(historyCount),
    refetchInterval: 30000,
  });

  const handleRefresh = () => {
    refetchRunning();
    refetchHistory();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Activity & History</h3>
          <p className="text-sm text-muted-foreground">
            View currently executing jobs and global execution history.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isFetchingHistory}>
          <RefreshCw className={isFetchingHistory ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      {/* Running Jobs Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-blue-500" />
            Current Executions
          </CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingRunning ? (
            <div className="flex items-center justify-center p-4">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !runningJobs || runningJobs.length === 0 ? (
            <div className="text-sm text-muted-foreground py-4 text-center">
              No jobs currently running.
            </div>
          ) : (
            <div className="space-y-2">
              {runningJobs.map((job, i) => (
                <div key={i} className="flex items-center justify-between p-3 border rounded-md bg-muted/40">
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">{job.jobName}</span>
                    <span className="text-xs text-muted-foreground">{job.jobGroup}</span>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-end text-xs text-muted-foreground">
                      <span>Started {new Date(job.fireTimeUtc).toLocaleTimeString()}</span>
                      <span className="font-mono">{formatDuration(job.runTimeMs)}</span>
                    </div>
                    <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* History Section */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
             <Clock className="h-4 w-4" />
             Global Execution History
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-[500px]">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[180px]">Time</TableHead>
                  <TableHead className="w-[150px]">Job</TableHead>
                  <TableHead className="w-[100px]">Type</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[100px]">Duration</TableHead>
                  <TableHead>Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoadingHistory ? (
                   <TableRow>
                     <TableCell colSpan={6} className="h-24 text-center">
                       <Loader2 className="h-6 w-6 animate-spin mx-auto text-muted-foreground" />
                     </TableCell>
                   </TableRow>
                ) : !history || history.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-24 text-center text-muted-foreground">
                      No history available.
                    </TableCell>
                  </TableRow>
                ) : (
                  history.map((entry) => (
                    <TableRow key={`${entry.jobType}-${entry.id}`}>
                      <TableCell className="font-mono text-xs whitespace-nowrap">
                        {new Date(entry.timestampUtc).toLocaleString()}
                      </TableCell>
                      <TableCell className="font-medium text-sm">
                        {entry.jobName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className="capitalize text-[10px] px-1 py-0 h-5">
                          {entry.jobType}
                        </Badge>
                      </TableCell>
                      <TableCell>
                         {entry.success ? (
                            <div className="flex items-center gap-1 text-green-500 text-xs font-medium">
                              <CheckCircle className="h-3 w-3" /> Success
                            </div>
                         ) : (
                            <div className="flex items-center gap-1 text-red-500 text-xs font-medium">
                              <XCircle className="h-3 w-3" /> Failed
                            </div>
                         )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground font-mono">
                         {formatDuration(entry.durationMs)}
                      </TableCell>
                      <TableCell className="text-xs max-w-[300px]">
                        <div title={entry.message || ""} className="truncate">
                          {entry.message}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </ScrollArea>
        </CardContent>
      </Card>
      
      <div className="flex justify-center">
        <Button 
          variant="outline" 
          size="sm" 
          onClick={() => setHistoryCount(c => c + 50)}
          disabled={isLoadingHistory || (history && history.length < historyCount)}
        >
          Load More
        </Button>
      </div>
    </div>
  );
}
