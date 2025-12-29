/**
 * GpuStatsPanel component for displaying GPU utilization, memory, and temperature.
 * Shows one card per detected GPU with progress bars and stats.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import type { GpuSnapshot } from '../types';

interface GpuStatsPanelProps {
  data: GpuSnapshot[];
}

/**
 * Formats bytes to human-readable units.
 */
function formatBytes(bytes: number | null): string {
  if (bytes === null) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * GpuStatsPanel displays GPU stats for all detected GPUs.
 */
export function GpuStatsPanel({ data }: GpuStatsPanelProps) {
  if (data.length === 0) {
    return null; // Don't render if no data
  }

  // Group by GPU index and get the latest snapshot for each
  const latestByGpu = new Map<number, GpuSnapshot>();
  for (const snapshot of data) {
    const existing = latestByGpu.get(snapshot.gpuIndex);
    if (!existing || new Date(snapshot.timestamp) > new Date(existing.timestamp)) {
      latestByGpu.set(snapshot.gpuIndex, snapshot);
    }
  }

  const gpus = Array.from(latestByGpu.values()).sort((a, b) => a.gpuIndex - b.gpuIndex);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium">GPU Status</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {gpus.map((gpu) => {
            const memoryPercent = 
              gpu.memoryUsedBytes !== null && gpu.memoryTotalBytes !== null && gpu.memoryTotalBytes > 0
                ? (gpu.memoryUsedBytes / gpu.memoryTotalBytes) * 100
                : null;
            
            return (
              <div key={gpu.gpuIndex} className="space-y-2 pb-3 border-b border-border last:border-0 last:pb-0">
                {/* GPU Header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-muted-foreground">GPU {gpu.gpuIndex}</span>
                    <span className="text-sm font-medium">{gpu.name || gpu.vendor}</span>
                  </div>
                  {gpu.temperatureC !== null && (
                    <span className={`text-xs font-medium ${gpu.temperatureC > 80 ? 'text-destructive' : gpu.temperatureC > 70 ? 'text-amber-500' : 'text-muted-foreground'}`}>
                      🌡️ {gpu.temperatureC}°C
                    </span>
                  )}
                </div>

                {/* Utilization */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Utilization</span>
                    <span className="font-medium">
                      {gpu.utilizationPercent !== null ? `${gpu.utilizationPercent.toFixed(0)}%` : '--'}
                    </span>
                  </div>
                  {gpu.utilizationPercent !== null ? (
                    <Progress 
                      value={gpu.utilizationPercent} 
                      className="h-2"
                    />
                  ) : (
                    <div className="h-2 rounded-full bg-muted" />
                  )}
                </div>

                {/* Memory */}
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">Memory</span>
                    <span className="font-medium">
                      {gpu.memoryUsedBytes !== null && gpu.memoryTotalBytes !== null
                        ? `${formatBytes(gpu.memoryUsedBytes)} / ${formatBytes(gpu.memoryTotalBytes)}`
                        : '--'}
                    </span>
                  </div>
                  {memoryPercent !== null ? (
                    <Progress 
                      value={memoryPercent} 
                      className="h-2"
                    />
                  ) : (
                    <div className="h-2 rounded-full bg-muted" />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
