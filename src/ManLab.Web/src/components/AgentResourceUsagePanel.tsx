import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Cpu, MemoryStick, Binary, Layers } from "lucide-react";
import type { AgentResourceUsage } from "../types";

interface AgentResourceUsagePanelProps {
  data: AgentResourceUsage[];
}

/**
 * Formats bytes to a human-readable string.
 */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes === 0) return "0 B";

  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

/**
 * Formats a percentage value.
 */
function formatPercent(value: number | null): string {
  if (value === null) return "-";
  return value.toFixed(1) + "%";
}

/**
 * Calculates a simple sparkline-style representation (returns array of heights 0-100%).
 */
function calculateSparkline(
  data: AgentResourceUsage[],
  accessor: (d: AgentResourceUsage) => number | null,
  maxValue?: number
): number[] {
  if (data.length === 0) return [];

  const values = data
    .slice()
    .reverse()
    .slice(0, 20)
    .map(accessor)
    .filter((v) => v !== null) as number[];

  if (values.length === 0) return [];

  const max = maxValue ?? (Math.max(...values) || 1);

  return values.map((v) => Math.min((v / max) * 100, 100));
}

export function AgentResourceUsagePanel({ data }: AgentResourceUsagePanelProps) {
  if (!data || data.length === 0) {
    return null;
  }

  // Get the latest data point
  const latest = data[0];

  // Prepare sparkline data
  const cpuSparkline = calculateSparkline(data, (d) => d.cpuPercent, 100);
  const memorySparkline = calculateSparkline(data, (d) => d.memoryBytes);
  const gcSparkline = calculateSparkline(data, (d) => d.gcHeapBytes);

  // Calculate averages for the period
  const validCpuValues = data
    .map((d) => d.cpuPercent)
    .filter((v) => v !== null) as number[];
  const avgCpu = validCpuValues.length > 0
    ? validCpuValues.reduce((a, b) => a + b, 0) / validCpuValues.length
    : null;

  return (
    <Card className="col-span-full lg:col-span-1">
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-medium flex items-center gap-2">
          <Cpu className="w-4 h-4 text-muted-foreground" />
          Agent Process
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
                <span className="text-xs text-muted-foreground">
                  avg {formatPercent(avgCpu)}
                </span>
              )}
            </div>
            {cpuSparkline.length > 0 && (
              <div className="flex items-end gap-[2px] h-8">
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
              <div className="flex items-end gap-[2px] h-8">
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
              <div className="flex items-end gap-[2px] h-8">
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
                {latest.threadCount ?? "-"}
              </span>
            </div>
            <div className="text-xs text-muted-foreground h-8 flex items-center">
              Active threads in agent process
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
