import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Play, PauseCircle, PlayCircle, Settings2, Cpu, Server } from "lucide-react";
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
  fetchScheduledNetworkTools,
  updateScheduledNetworkTool,
  runScheduledNetworkTool,
  updateGlobalJobSchedule,
  updateGlobalJobEnabled,
  triggerGlobalJob,
} from "@/api";
import type { MonitorJobSummary, HttpMonitorConfig, TrafficMonitorConfig, ScheduledNetworkToolConfig } from "@/types";
import {
  HttpMonitorEditForm,
  TrafficMonitorEditForm,
  NetworkToolEditForm,
  GlobalJobEditForm,
} from "./JobEditForms";

function formatDate(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

// Helper function to get job type badge info
function getJobTypeInfo(type: MonitorJobSummary["type"]): { label: string; variant: "default" | "secondary"; icon?: React.ReactNode } {
  switch (type) {
    case "http":
      return { label: "HTTP", variant: "default" };
    case "traffic":
      return { label: "Traffic", variant: "secondary" };
    case "network-tool":
      return { label: "Network Tool", variant: "secondary" };
    case "system-update":
      return { label: "System Update", variant: "secondary", icon: <Server className="h-3 w-3" /> };
    case "agent-update":
      return { label: "Agent Update", variant: "secondary", icon: <Cpu className="h-3 w-3" /> };
    default:
      return { label: type, variant: "secondary" };
  }
}

export function MonitorJobsPanel() {
  const queryClient = useQueryClient();

  // Edit mode state
  const [editingJobId, setEditingJobId] = useState<string | null>(null);
  const [editingHttpConfig, setEditingHttpConfig] = useState<HttpMonitorConfig | null>(null);
  const [editingTrafficConfig, setEditingTrafficConfig] = useState<TrafficMonitorConfig | null>(null);
  const [editingNetworkTool, setEditingNetworkTool] = useState<ScheduledNetworkToolConfig | null>(null);
  const [editingGlobalJob, setEditingGlobalJob] = useState<{
    type: "agent-update" | "system-update";
    schedule: string;
    enabled: boolean;
  } | null>(null);

  // Queries
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

  const { data: networkTools } = useQuery({
    queryKey: ["monitoring", "network-tools"],
    queryFn: fetchScheduledNetworkTools,
  });

  // Mutations for existing functionality
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
      } else if (job.type === "traffic") {
        await runTrafficMonitor();
      } else if (job.type === "network-tool") {
        await runScheduledNetworkTool(job.id);
      } else if (job.type === "agent-update" || job.type === "system-update") {
        await triggerGlobalJob(job.type);
      }
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "jobs"] });
    },
  });

  // Mutations for edit functionality
  const updateHttpMutation = useMutation({
    mutationFn: async (config: HttpMonitorConfig) =>
      updateHttpMonitor(config.id, {
        name: config.name,
        url: config.url,
        method: config.method ?? "GET",
        expectedStatus: config.expectedStatus,
        bodyContains: config.bodyContains,
        timeoutMs: config.timeoutMs,
        cron: config.cron,
        enabled: config.enabled,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring"] });
      handleCancelEdit();
    },
  });

  const updateTrafficMutation = useMutation({
    mutationFn: async (config: TrafficMonitorConfig) =>
      updateTrafficMonitorConfig({
        cron: config.cron,
        enabled: config.enabled,
        interfaceName: config.interfaceName,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring"] });
      handleCancelEdit();
    },
  });

  const updateNetworkToolMutation = useMutation({
    mutationFn: async (config: ScheduledNetworkToolConfig) =>
      updateScheduledNetworkTool(config.id, {
        name: config.name,
        toolType: config.toolType,
        target: config.target,
        parameters: config.parameters,
        cron: config.cron,
        enabled: config.enabled,
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring"] });
      handleCancelEdit();
    },
  });

  const updateGlobalJobMutation = useMutation({
    mutationFn: async ({
      type,
      schedule,
      enabled,
    }: {
      type: "agent-update" | "system-update";
      schedule: string;
      enabled: boolean;
    }) => {
      // Update schedule
      await updateGlobalJobSchedule(type, schedule);
      // Update enabled state
      await updateGlobalJobEnabled(type, enabled);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring"] });
      handleCancelEdit();
    },
  });

  // Helper maps
  const httpMonitorMap = useMemo(() => {
    const map = new Map<string, HttpMonitorConfig>();
    (httpMonitors ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [httpMonitors]);

  const networkToolMap = useMemo(() => {
    const map = new Map<string, ScheduledNetworkToolConfig>();
    (networkTools ?? []).forEach((item) => map.set(item.id, item));
    return map;
  }, [networkTools]);

  const traffic = trafficConfig ?? undefined;

  // Edit handlers
  const handleEditJob = async (job: MonitorJobSummary) => {
    if (job.type === "http") {
      const config = httpMonitorMap.get(job.id);
      if (config) {
        setEditingHttpConfig({ ...config });
        setEditingJobId(job.id);
      }
    } else if (job.type === "traffic") {
      if (traffic) {
        setEditingTrafficConfig({ ...traffic });
        setEditingJobId(job.id);
      }
    } else if (job.type === "network-tool") {
      const config = networkToolMap.get(job.id);
      if (config) {
        setEditingNetworkTool({ ...config });
        setEditingJobId(job.id);
      }
    } else if (job.type === "system-update" || job.type === "agent-update") {
      // For global jobs, use the schedule and enabled from the job
      setEditingGlobalJob({
        type: job.type,
        schedule: job.schedule,
        enabled: job.enabled,
      });
      setEditingJobId(job.id);
    }
  };

  const handleCancelEdit = () => {
    setEditingJobId(null);
    setEditingHttpConfig(null);
    setEditingTrafficConfig(null);
    setEditingNetworkTool(null);
    setEditingGlobalJob(null);
  };

  const handleSaveHttp = () => {
    if (editingHttpConfig) {
      updateHttpMutation.mutate(editingHttpConfig);
    }
  };

  const handleSaveTraffic = () => {
    if (editingTrafficConfig) {
      updateTrafficMutation.mutate(editingTrafficConfig);
    }
  };

  const handleSaveNetworkTool = () => {
    if (editingNetworkTool) {
      updateNetworkToolMutation.mutate(editingNetworkTool);
    }
  };

  const handleSaveGlobalJob = () => {
    if (editingGlobalJob) {
      updateGlobalJobMutation.mutate(editingGlobalJob);
    }
  };

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
            const jobTypeInfo = getJobTypeInfo(job.type);
            const canToggle = job.type === "http" || job.type === "traffic";
            const canRun = job.type === "http" || job.type === "traffic" || job.type === "network-tool" || job.type === "agent-update" || job.type === "system-update";
            const isEditing = editingJobId === job.id;

            return (
              <div key={`${job.type}-${job.id}`} className="flex flex-col p-4">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{job.name}</span>
                      <Badge variant={jobTypeInfo.variant}>
                        {jobTypeInfo.icon}
                        <span className={jobTypeInfo.icon ? "ml-1" : ""}>{jobTypeInfo.label}</span>
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
                    {canToggle && (
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
                    )}
                    {canRun && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => runJobMutation.mutate(job)}
                      >
                        {enabled ? <Play className="h-4 w-4" /> : <PlayCircle className="h-4 w-4" />}
                        Run now
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEditJob(job)}
                      disabled={editingJobId !== null && !isEditing}
                    >
                      <Settings2 className="h-4 w-4" />
                      {isEditing ? "Editing..." : "Edit"}
                    </Button>
                    {enabled ? (
                      <PauseCircle className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <PlayCircle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </div>

                {/* Inline Edit Form */}
                {isEditing && (
                  <div className="mt-3">
                    {job.type === "http" && editingHttpConfig && (
                      <HttpMonitorEditForm
                        config={editingHttpConfig}
                        onChange={setEditingHttpConfig}
                        onSave={handleSaveHttp}
                        onCancel={handleCancelEdit}
                        isSaving={updateHttpMutation.isPending}
                      />
                    )}
                    {job.type === "traffic" && editingTrafficConfig && (
                      <TrafficMonitorEditForm
                        config={editingTrafficConfig}
                        onChange={setEditingTrafficConfig}
                        onSave={handleSaveTraffic}
                        onCancel={handleCancelEdit}
                        isSaving={updateTrafficMutation.isPending}
                      />
                    )}
                    {job.type === "network-tool" && editingNetworkTool && (
                      <NetworkToolEditForm
                        config={editingNetworkTool}
                        onChange={setEditingNetworkTool}
                        onSave={handleSaveNetworkTool}
                        onCancel={handleCancelEdit}
                        isSaving={updateNetworkToolMutation.isPending}
                      />
                    )}
                    {(job.type === "system-update" || job.type === "agent-update") && editingGlobalJob && (
                      <GlobalJobEditForm
                        jobType={editingGlobalJob.type}
                        schedule={editingGlobalJob.schedule}
                        enabled={editingGlobalJob.enabled}
                        onChange={(data) => setEditingGlobalJob({ ...editingGlobalJob, ...data })}
                        onSave={handleSaveGlobalJob}
                        onCancel={handleCancelEdit}
                        isSaving={updateGlobalJobMutation.isPending}
                      />
                    )}
                  </div>
                )}
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
