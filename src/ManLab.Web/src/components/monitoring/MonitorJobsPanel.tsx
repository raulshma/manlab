import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Play, PauseCircle, PlayCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  fetchMonitorJobs,
  fetchHttpMonitors,
  fetchTrafficMonitorConfig,
  updateHttpMonitor,
  updateTrafficMonitorConfig,
  runHttpMonitor,
  runTrafficMonitor,
} from "@/api";
import type { MonitorJobSummary, HttpMonitorConfig, TrafficMonitorConfig } from "@/types";

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

export function MonitorJobsPanel() {
  const queryClient = useQueryClient();

  const { data: jobs, isLoading, refetch, isFetching } = useQuery({
    queryKey: ["monitoring", "jobs"],
    queryFn: fetchMonitorJobs,
    refetchInterval: 15000,
  });

  const { data: httpMonitors } = useQuery({
    queryKey: ["monitoring", "http", "configs"],
    queryFn: fetchHttpMonitors,
  });

  const { data: trafficConfig } = useQuery({
    queryKey: ["monitoring", "traffic", "config"],
    queryFn: fetchTrafficMonitorConfig,
  });

  const toggleHttpMutation = useMutation({
    mutationFn: async (config: HttpMonitorConfig) =>
      updateHttpMonitor(config.id, {
        name: config.name,
        url: config.url,
        method: config.method ?? "GET",
        expectedStatus: config.expectedStatus,
        bodyContains: config.bodyContains,
        timeoutMs: config.timeoutMs,
        cron: config.cron,
        enabled: !config.enabled,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring"] });
    },
  });

  const toggleTrafficMutation = useMutation({
    mutationFn: async (config: TrafficMonitorConfig) =>
      updateTrafficMonitorConfig({
        cron: config.cron,
        enabled: !config.enabled,
        interfaceName: config.interfaceName,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring"] });
    },
  });

  const runJobMutation = useMutation({
    mutationFn: async (job: MonitorJobSummary) => {
      if (job.type === "http") {
        await runHttpMonitor(job.id);
      } else {
        await runTrafficMonitor();
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "jobs"] });
    },
  });

  const httpMonitorMap = useMemo(() => {
    const map = new Map<string, HttpMonitorConfig>();
    (httpMonitors ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [httpMonitors]);

  const traffic = trafficConfig;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">Job Management</h3>
          <p className="text-sm text-muted-foreground">
            Schedule, pause, or trigger background monitors.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={isFetching ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 gap-0 divide-y">
          {(jobs ?? []).map((job) => {
            const enabled = job.enabled;
            return (
              <div key={`${job.type}-${job.id}`} className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{job.name}</span>
                    <Badge variant={job.type === "http" ? "default" : "secondary"}>
                      {job.type === "http" ? "HTTP" : "Traffic"}
                    </Badge>
                    {!enabled && <Badge variant="outline">Paused</Badge>}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">
                    Schedule: {job.schedule}
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    Last run: {formatDate(job.lastRunAtUtc)} · Next: {formatDate(job.nextRunAtUtc)}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={enabled}
                      onCheckedChange={() => {
                        if (job.type === "http") {
                          const config = httpMonitorMap.get(job.id);
                          if (config) {
                            toggleHttpMutation.mutate(config);
                          }
                        } else if (traffic) {
                          toggleTrafficMutation.mutate(traffic);
                        }
                      }}
                    />
                    <span className="text-xs text-muted-foreground">{enabled ? "Enabled" : "Paused"}</span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => runJobMutation.mutate(job)}
                  >
                    {enabled ? <Play className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                    Run now
                  </Button>
                  {enabled ? (
                    <PauseCircle className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <PlayCircle className="h-4 w-4 text-muted-foreground" />
                  )}
                </div>
              </div>
            );
          })}

          {!isLoading && (!jobs || jobs.length === 0) && (
            <div className="p-6 text-center text-sm text-muted-foreground">
              No monitor jobs configured yet.
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}
