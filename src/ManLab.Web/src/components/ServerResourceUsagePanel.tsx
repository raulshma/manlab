import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, MemoryStick, Binary, Layers, Server } from "lucide-react";
import type { ServerResourceUsage } from "@/types";

interface ServerResourceUsagePanelProps {
  data: ServerResourceUsage[];
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatPercent(value: number | null): string {
  if (value === null || Number.isNaN(value)) return "—";
  return `${value.toFixed(1)}%`;
}

function calculateSparkline(
  data: ServerResourceUsage[],
  accessor: (d: ServerResourceUsage) => number | null,
  maxValue?: number
): number[] {
  const values = data
    .map(accessor)
    .filter((v): v is number => v !== null && !Number.isNaN(v));

  if (values.length === 0) return [];

  const max = maxValue ?? Math.max(...values);
  if (max <= 0) return values.map(() => 0);

  return values.map((v) => (v / max) * 100);
}

export function ServerResourceUsagePanel({ data }: ServerResourceUsagePanelProps) {
  if (!data || data.length === 0) {
    return null;
  }

  const latest = data[0];
  const cpuSparkline = calculateSparkline(data, (d) => d.cpuPercent, 100);
  const memorySparkline = calculateSparkline(data, (d) => d.memoryBytes ?? null);
  const gcSparkline = calculateSparkline(data, (d) => d.gcHeapBytes ?? null);

  const validCpuValues = data
    .map((d) => d.cpuPercent)
    .filter((v): v is number => v !== null && !Number.isNaN(v));
  const avgCpu = validCpuValues.length > 0
    ? validCpuValues.reduce((a, b) => a + b, 0) / validCpuValues.length
    : null;

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Server className="w-4 h-4 text-muted-foreground" />
          Server Process
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-4">
          {/* CPU Usage */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Cpu className="w-3.5 h-3.5" />
              CPU Usage
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {formatPercent(latest.cpuPercent)}
              </span>
              {avgCpu !== null && (
                <span className="text-xs text-muted-foreground">avg {formatPercent(avgCpu)}</span>
              )}
            </div>
            {cpuSparkline.length > 0 && (
              <div className="flex items-end gap-0.5 h-8">
                {cpuSparkline.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-primary/60 rounded-sm transition-all"
                    style={{ height: `${Math.max(h, 4)}%` }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Memory Usage */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MemoryStick className="w-3.5 h-3.5" />
              Memory
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {formatBytes(latest.memoryBytes)}
              </span>
            </div>
            {memorySparkline.length > 0 && (
              <div className="flex items-end gap-0.5 h-8">
                {memorySparkline.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-chart-2/60 rounded-sm transition-all"
                    style={{ height: `${Math.max(h, 4)}%` }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* GC Heap */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Binary className="w-3.5 h-3.5" />
              GC Heap
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {formatBytes(latest.gcHeapBytes)}
              </span>
            </div>
            {gcSparkline.length > 0 && (
              <div className="flex items-end gap-0.5 h-8">
                {gcSparkline.map((h, i) => (
                  <div
                    key={i}
                    className="flex-1 bg-chart-3/60 rounded-sm transition-all"
                    style={{ height: `${Math.max(h, 4)}%` }}
                  />
                ))}
              </div>
            )}
          </div>

          {/* Thread Count */}
          <div className="space-y-2">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Layers className="w-3.5 h-3.5" />
              Threads
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-semibold tabular-nums">
                {latest.threadCount ?? "—"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground h-8 flex items-center">
              Active threads in server process
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
