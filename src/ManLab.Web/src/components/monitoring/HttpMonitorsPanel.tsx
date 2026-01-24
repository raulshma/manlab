import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, RefreshCw, Trash2 } from "lucide-react";
import {
  createHttpMonitor,
  deleteHttpMonitor,
  fetchHttpMonitorHistory,
  fetchHttpMonitors,
  runHttpMonitor,
  updateHttpMonitor,
} from "@/api";
import type { HttpMonitorConfig } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";

const DEFAULT_CRON = "*/60 * * * * ?";

function formatUtc(value: string | null): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function HistoryTable({ monitorId }: { monitorId: string }) {
  const { data } = useQuery({
    queryKey: ["monitoring", "http", "history", monitorId],
    queryFn: () => fetchHttpMonitorHistory(monitorId, 20),
    refetchInterval: 15000,
  });

  const rows = data ?? [];
  if (rows.length === 0) {
    return <div className="text-xs text-muted-foreground">No checks yet.</div>;
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left">Time</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Latency</th>
            <th className="px-3 py-2 text-left">SSL</th>
            <th className="px-3 py-2 text-left">Notes</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} className="border-t">
              <td className="px-3 py-2">{formatUtc(row.timestampUtc)}</td>
              <td className="px-3 py-2">
                <Badge variant={row.success ? "default" : "destructive"}>
                  {row.statusCode ?? "—"}
                </Badge>
              </td>
              <td className="px-3 py-2">{row.responseTimeMs} ms</td>
              <td className="px-3 py-2">
                {row.sslDaysRemaining !== null ? `${row.sslDaysRemaining}d` : "—"}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.errorMessage ?? (row.keywordMatched === false ? "Keyword missing" : "")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function HttpMonitorsPanel() {
  const queryClient = useQueryClient();
  const { data: monitors, isLoading } = useQuery({
    queryKey: ["monitoring", "http", "configs"],
    queryFn: fetchHttpMonitors,
  });

  const [draft, setDraft] = useState({
    name: "",
    url: "",
    method: "GET",
    expectedStatus: "",
    bodyContains: "",
    timeoutMs: "5000",
    cron: DEFAULT_CRON,
    enabled: true,
  });

  const [editState, setEditState] = useState<Record<string, Partial<HttpMonitorConfig>>>({});

  const createMutation = useMutation({
    mutationFn: () =>
      createHttpMonitor({
        name: draft.name,
        url: draft.url,
        method: draft.method,
        expectedStatus: draft.expectedStatus ? Number(draft.expectedStatus) : null,
        bodyContains: draft.bodyContains || null,
        timeoutMs: draft.timeoutMs ? Number(draft.timeoutMs) : null,
        cron: draft.cron,
        enabled: draft.enabled,
      }),
    onSuccess: async () => {
      setDraft({
        name: "",
        url: "",
        method: "GET",
        expectedStatus: "",
        bodyContains: "",
        timeoutMs: "5000",
        cron: DEFAULT_CRON,
        enabled: true,
      });
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "http"] });
    },
  });

  const updateMutation = useMutation({
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
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "http"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteHttpMonitor,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "http"] });
    },
  });

  const runMutation = useMutation({
    mutationFn: runHttpMonitor,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "http"] });
    },
  });

  const items = useMemo(() => monitors ?? [], [monitors]);

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Add HTTP Monitor</h3>
            <p className="text-sm text-muted-foreground">
              Create a recurring health check for an HTTP endpoint.
            </p>
          </div>
          <Button onClick={() => createMutation.mutate()} disabled={!draft.name || !draft.url || createMutation.isPending}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            placeholder="Name"
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          <Input
            placeholder="https://service.local/health"
            value={draft.url}
            onChange={(event) => setDraft({ ...draft, url: event.target.value })}
          />
          <Input
            placeholder="Method (GET)"
            value={draft.method}
            onChange={(event) => setDraft({ ...draft, method: event.target.value })}
          />
          <Input
            placeholder="Expected status (200)"
            value={draft.expectedStatus}
            onChange={(event) => setDraft({ ...draft, expectedStatus: event.target.value })}
          />
          <Input
            placeholder="Keyword to match (optional)"
            value={draft.bodyContains}
            onChange={(event) => setDraft({ ...draft, bodyContains: event.target.value })}
          />
          <Input
            placeholder="Timeout ms (5000)"
            value={draft.timeoutMs}
            onChange={(event) => setDraft({ ...draft, timeoutMs: event.target.value })}
          />
          <Input
            placeholder="Cron (*/60 * * * * ?)"
            value={draft.cron}
            onChange={(event) => setDraft({ ...draft, cron: event.target.value })}
          />
          <div className="flex items-center gap-2">
            <Switch
              checked={draft.enabled}
              onCheckedChange={(checked) => setDraft({ ...draft, enabled: checked })}
            />
            <span className="text-sm text-muted-foreground">Enabled</span>
          </div>
        </div>
      </Card>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold">Configured Monitors</h3>
          <Button variant="outline" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["monitoring", "http"] })}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
        </div>

        {isLoading && <div className="text-sm text-muted-foreground">Loading monitors...</div>}

        {!isLoading && items.length === 0 && (
          <div className="text-sm text-muted-foreground">No HTTP monitors configured.</div>
        )}

        <div className="space-y-4">
          {items.map((monitor) => {
            const edited = { ...monitor, ...editState[monitor.id] };
            return (
              <Card key={monitor.id} className="p-4 space-y-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{monitor.name}</span>
                      <Badge variant={monitor.enabled ? "default" : "outline"}>
                        {monitor.enabled ? "Enabled" : "Paused"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">Last run: {formatUtc(monitor.lastRunAtUtc)}</div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm" onClick={() => runMutation.mutate(monitor.id)}>
                      Run now
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteMutation.mutate(monitor.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <Input
                    value={edited.name}
                    onChange={(event) => setEditState((prev) => ({
                      ...prev,
                      [monitor.id]: { ...prev[monitor.id], name: event.target.value },
                    }))}
                  />
                  <Input
                    value={edited.url}
                    onChange={(event) => setEditState((prev) => ({
                      ...prev,
                      [monitor.id]: { ...prev[monitor.id], url: event.target.value },
                    }))}
                  />
                  <Input
                    value={edited.method ?? "GET"}
                    onChange={(event) => setEditState((prev) => ({
                      ...prev,
                      [monitor.id]: { ...prev[monitor.id], method: event.target.value },
                    }))}
                  />
                  <Input
                    value={edited.expectedStatus?.toString() ?? ""}
                    onChange={(event) => setEditState((prev) => ({
                      ...prev,
                      [monitor.id]: { ...prev[monitor.id], expectedStatus: event.target.value ? Number(event.target.value) : null },
                    }))}
                  />
                  <Input
                    placeholder="Keyword"
                    value={edited.bodyContains ?? ""}
                    onChange={(event) => setEditState((prev) => ({
                      ...prev,
                      [monitor.id]: { ...prev[monitor.id], bodyContains: event.target.value || null },
                    }))}
                  />
                  <Input
                    value={edited.timeoutMs.toString()}
                    onChange={(event) => setEditState((prev) => ({
                      ...prev,
                      [monitor.id]: { ...prev[monitor.id], timeoutMs: Number(event.target.value) },
                    }))}
                  />
                  <Input
                    value={edited.cron}
                    onChange={(event) => setEditState((prev) => ({
                      ...prev,
                      [monitor.id]: { ...prev[monitor.id], cron: event.target.value },
                    }))}
                  />
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={edited.enabled}
                      onCheckedChange={(checked) => setEditState((prev) => ({
                        ...prev,
                        [monitor.id]: { ...prev[monitor.id], enabled: checked },
                      }))}
                    />
                    <span className="text-sm text-muted-foreground">Enabled</span>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => updateMutation.mutate(edited)}
                  >
                    Save changes
                  </Button>
                </div>

                <HistoryTable monitorId={monitor.id} />
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
