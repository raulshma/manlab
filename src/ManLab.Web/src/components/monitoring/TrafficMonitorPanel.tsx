import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw, Trash2 } from "lucide-react";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  fetchTrafficMonitorConfig,
  fetchTrafficSamples,
  runTrafficMonitor,
  updateTrafficMonitorConfig,
  deleteTrafficMonitorConfig,
} from "@/api";

function formatBytesPerSec(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1024) return `${value.toFixed(0)} B/s`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

function formatTime(value: string): string {
  try {
    return new Date(value).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return value;
  }
}

export function TrafficMonitorPanel() {
  const queryClient = useQueryClient();
  const [count, setCount] = useState(360);
  const [selectedInterface, setSelectedInterface] = useState<string | undefined>(undefined);
  const [draftCron, setDraftCron] = useState<string | null>(null);
  const [draftInterface, setDraftInterface] = useState<string | null>(null);
  const [draftEnabled, setDraftEnabled] = useState<boolean | null>(null);
  const DEFAULT_CRON = "*/30 * * * * ?";

  const { data: config } = useQuery({
    queryKey: ["monitoring", "traffic", "config"],
    queryFn: fetchTrafficMonitorConfig,
  });

  const { data: samples, isLoading } = useQuery({
    queryKey: ["monitoring", "traffic", "history", count, selectedInterface],
    queryFn: () => fetchTrafficSamples(count, selectedInterface),
    refetchInterval: 15000,
  });

  const updateMutation = useMutation({
    mutationFn: async (payload: { cron: string; enabled?: boolean | null; interfaceName?: string | null }) =>
      updateTrafficMonitorConfig(payload),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "traffic"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteTrafficMonitorConfig,
    onSuccess: async () => {
      setDraftCron(null);
      setDraftInterface(null);
      setDraftEnabled(null);
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "traffic"] });
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "jobs"] });
    },
  });

  const runMutation = useMutation({
    mutationFn: runTrafficMonitor,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["monitoring", "traffic", "history"] });
    },
  });


  const interfaces = useMemo(() => {
    const names = new Set<string>();
    (samples ?? []).forEach((sample) => names.add(sample.interfaceName));
    return Array.from(names).sort();
  }, [samples]);

  const chartData = useMemo(() => {
    return (samples ?? []).slice().reverse().map((sample) => ({
      timestampUtc: sample.timestampUtc,
      rxBytesPerSec: sample.rxBytesPerSec ?? 0,
      txBytesPerSec: sample.txBytesPerSec ?? 0,
    }));
  }, [samples]);

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold">Traffic Monitor Settings</h3>
            <p className="text-sm text-muted-foreground">Configure server-side interface sampling.</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => runMutation.mutate()} disabled={!config}>
              Run now
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteMutation.mutate()}
              disabled={!config || deleteMutation.isPending}
            >
              <Trash2 className="h-4 w-4" />
              Delete job
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Input
            placeholder="Cron schedule"
            value={draftCron ?? config?.cron ?? DEFAULT_CRON}
            onChange={(event) => setDraftCron(event.target.value)}
          />
          <Input
            placeholder="Interface name (optional)"
            value={draftInterface ?? config?.interfaceName ?? ""}
            onChange={(event) => setDraftInterface(event.target.value)}
          />
          <div className="flex items-center gap-2">
            <Switch
              checked={draftEnabled ?? config?.enabled ?? true}
              onCheckedChange={(checked) => setDraftEnabled(checked)}
            />
            <span className="text-sm text-muted-foreground">Enabled</span>
          </div>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={() =>
                updateMutation.mutate({
                  cron: draftCron ?? config?.cron ?? DEFAULT_CRON,
                  enabled: draftEnabled ?? config?.enabled ?? true,
                  interfaceName: (draftInterface ?? config?.interfaceName ?? "") || null,
                })
              }
            >
              {config ? "Save changes" : "Create job"}
            </Button>
          </div>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-lg font-semibold">Traffic History</h3>
            <p className="text-sm text-muted-foreground">Recent interface throughput samples.</p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Button variant={count === 180 ? "secondary" : "outline"} size="sm" onClick={() => setCount(180)}>30 Min</Button>
            <Button variant={count === 360 ? "secondary" : "outline"} size="sm" onClick={() => setCount(360)}>1 Hour</Button>
            <Button variant={count === 720 ? "secondary" : "outline"} size="sm" onClick={() => setCount(720)}>2 Hours</Button>
            <Button variant="ghost" size="sm" onClick={() => queryClient.invalidateQueries({ queryKey: ["monitoring", "traffic", "history"] })}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 text-xs">
          <Button
            variant={!selectedInterface ? "secondary" : "outline"}
            size="sm"
            onClick={() => setSelectedInterface(undefined)}
          >
            All Interfaces
          </Button>
          {interfaces.map((iface) => (
            <Button
              key={iface}
              variant={selectedInterface === iface ? "secondary" : "outline"}
              size="sm"
              onClick={() => setSelectedInterface(iface)}
            >
              {iface}
            </Button>
          ))}
        </div>

        <div className="h-80">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Loading samples...
            </div>
          ) : chartData.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              No traffic samples yet.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="traffic-rx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="traffic-tx" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.1} />
                <XAxis dataKey="timestampUtc" tickFormatter={formatTime} minTickGap={40} />
                <YAxis tickFormatter={(value) => formatBytesPerSec(Number(value))} width={90} />
                <Tooltip
                  formatter={(value: number, name) => [formatBytesPerSec(value), name === "rxBytesPerSec" ? "Rx" : "Tx"]}
                  labelFormatter={(label) => formatTime(label)}
                />
                <Legend />
                <Area
                  type="monotone"
                  dataKey="rxBytesPerSec"
                  name="Rx"
                  stroke="hsl(142, 76%, 36%)"
                  fill="url(#traffic-rx)"
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="txBytesPerSec"
                  name="Tx"
                  stroke="hsl(221, 83%, 53%)"
                  fill="url(#traffic-tx)"
                  strokeWidth={2}
                />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </Card>
    </div>
  );
}
