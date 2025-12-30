/**
 * EnhancedGpuPanel component for displaying detailed GPU telemetry.
 * Shows utilization, memory, temperature, power, clocks, and process-level usage.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Cpu, 
  Thermometer, 
  Zap, 
  Gauge,
  Fan,
  AlertTriangle,
  Activity
} from 'lucide-react';
import type { EnhancedGpuTelemetry, GpuProcessInfo } from '../types';

interface EnhancedGpuPanelProps {
  data: EnhancedGpuTelemetry[] | null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function getVendorColor(vendor: string): string {
  switch (vendor.toLowerCase()) {
    case 'nvidia': return 'text-green-500';
    case 'amd': return 'text-red-500';
    case 'intel': return 'text-blue-500';
    default: return 'text-muted-foreground';
  }
}

function getVendorBadgeVariant(vendor: string): "default" | "secondary" | "destructive" | "outline" {
  switch (vendor.toLowerCase()) {
    case 'nvidia': return 'default';
    case 'amd': return 'destructive';
    case 'intel': return 'secondary';
    default: return 'outline';
  }
}

function getTempColor(temp: number | null): string {
  if (temp === null) return 'text-muted-foreground';
  if (temp >= 90) return 'text-red-600';
  if (temp >= 80) return 'text-orange-500';
  if (temp >= 70) return 'text-amber-500';
  return 'text-green-600';
}

function GpuOverviewCard({ gpu }: { gpu: EnhancedGpuTelemetry }) {
  const memoryPercent = gpu.memoryUsedBytes && gpu.memoryTotalBytes
    ? (gpu.memoryUsedBytes / gpu.memoryTotalBytes) * 100
    : null;

  return (
    <div className="p-4 rounded-lg border bg-card space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Cpu className={`w-5 h-5 ${getVendorColor(gpu.vendor)}`} />
          <div>
            <div className="font-medium">{gpu.name || `GPU ${gpu.index}`}</div>
            <div className="text-xs text-muted-foreground">
              {gpu.driverVersion && `Driver: ${gpu.driverVersion}`}
            </div>
          </div>
        </div>
        <Badge variant={getVendorBadgeVariant(gpu.vendor)} className="uppercase text-xs">
          {gpu.vendor}
        </Badge>
      </div>

      {/* Utilization */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">GPU Utilization</span>
          <span className="font-medium">{gpu.utilizationPercent?.toFixed(0) ?? '--'}%</span>
        </div>
        <Progress value={gpu.utilizationPercent ?? 0} className="h-2" />
      </div>

      {/* Memory */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Memory</span>
          <span className="font-medium">
            {formatBytes(gpu.memoryUsedBytes)} / {formatBytes(gpu.memoryTotalBytes)}
          </span>
        </div>
        <Progress value={memoryPercent ?? 0} className="h-2" />
      </div>

      {/* Quick Stats Grid */}
      <div className="grid grid-cols-3 gap-3 pt-2 border-t">
        <div className="text-center">
          <Thermometer className={`w-4 h-4 mx-auto mb-1 ${getTempColor(gpu.temperatureC)}`} />
          <div className={`text-lg font-bold ${getTempColor(gpu.temperatureC)}`}>
            {gpu.temperatureC?.toFixed(0) ?? '--'}°C
          </div>
          <div className="text-[10px] text-muted-foreground">Temperature</div>
        </div>
        <div className="text-center">
          <Zap className="w-4 h-4 mx-auto mb-1 text-amber-500" />
          <div className="text-lg font-bold">
            {gpu.powerDrawWatts?.toFixed(0) ?? '--'}W
          </div>
          <div className="text-[10px] text-muted-foreground">Power</div>
        </div>
        <div className="text-center">
          <Fan className="w-4 h-4 mx-auto mb-1 text-blue-500" />
          <div className="text-lg font-bold">
            {gpu.fanSpeedPercent?.toFixed(0) ?? '--'}%
          </div>
          <div className="text-[10px] text-muted-foreground">Fan</div>
        </div>
      </div>

      {/* Throttling Warning */}
      {gpu.isThrottling && (
        <div className="flex items-center gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
          <AlertTriangle className="w-4 h-4" />
          <span>Throttling: {gpu.throttleReasons?.join(', ') || 'Unknown reason'}</span>
        </div>
      )}
    </div>
  );
}

function GpuDetailedStats({ gpu }: { gpu: EnhancedGpuTelemetry }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {/* Utilization Details */}
      <div className="p-3 rounded-lg border bg-card space-y-2">
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Activity className="w-3 h-3" /> Utilization
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span>GPU Core</span>
            <span className="font-medium">{gpu.utilizationPercent?.toFixed(0) ?? '--'}%</span>
          </div>
          <div className="flex justify-between">
            <span>Memory Controller</span>
            <span className="font-medium">{gpu.memoryUtilizationPercent?.toFixed(0) ?? '--'}%</span>
          </div>
          <div className="flex justify-between">
            <span>Encoder</span>
            <span className="font-medium">{gpu.encoderUtilizationPercent?.toFixed(0) ?? '--'}%</span>
          </div>
          <div className="flex justify-between">
            <span>Decoder</span>
            <span className="font-medium">{gpu.decoderUtilizationPercent?.toFixed(0) ?? '--'}%</span>
          </div>
        </div>
      </div>

      {/* Temperature Details */}
      <div className="p-3 rounded-lg border bg-card space-y-2">
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Thermometer className="w-3 h-3" /> Temperature
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span>GPU Core</span>
            <span className={`font-medium ${getTempColor(gpu.temperatureC)}`}>
              {gpu.temperatureC?.toFixed(0) ?? '--'}°C
            </span>
          </div>
          <div className="flex justify-between">
            <span>Memory</span>
            <span className={`font-medium ${getTempColor(gpu.memoryTemperatureC)}`}>
              {gpu.memoryTemperatureC?.toFixed(0) ?? '--'}°C
            </span>
          </div>
          <div className="flex justify-between">
            <span>Hotspot</span>
            <span className={`font-medium ${getTempColor(gpu.hotspotTemperatureC)}`}>
              {gpu.hotspotTemperatureC?.toFixed(0) ?? '--'}°C
            </span>
          </div>
          <div className="flex justify-between">
            <span>Throttle Threshold</span>
            <span className="font-medium">{gpu.throttleTemperatureC?.toFixed(0) ?? '--'}°C</span>
          </div>
        </div>
      </div>

      {/* Power Details */}
      <div className="p-3 rounded-lg border bg-card space-y-2">
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Zap className="w-3 h-3" /> Power
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span>Current Draw</span>
            <span className="font-medium">{gpu.powerDrawWatts?.toFixed(1) ?? '--'}W</span>
          </div>
          <div className="flex justify-between">
            <span>Power Limit</span>
            <span className="font-medium">{gpu.powerLimitWatts?.toFixed(0) ?? '--'}W</span>
          </div>
          <div className="flex justify-between">
            <span>Default Limit</span>
            <span className="font-medium">{gpu.defaultPowerLimitWatts?.toFixed(0) ?? '--'}W</span>
          </div>
          <div className="flex justify-between">
            <span>Max Limit</span>
            <span className="font-medium">{gpu.maxPowerLimitWatts?.toFixed(0) ?? '--'}W</span>
          </div>
        </div>
      </div>

      {/* Clock Details */}
      <div className="p-3 rounded-lg border bg-card space-y-2">
        <div className="text-xs font-medium text-muted-foreground flex items-center gap-1">
          <Gauge className="w-3 h-3" /> Clocks
        </div>
        <div className="space-y-1 text-xs">
          <div className="flex justify-between">
            <span>Graphics</span>
            <span className="font-medium">{gpu.graphicsClockMhz ?? '--'} MHz</span>
          </div>
          <div className="flex justify-between">
            <span>Memory</span>
            <span className="font-medium">{gpu.memoryClockMhz ?? '--'} MHz</span>
          </div>
          <div className="flex justify-between">
            <span>Max Graphics</span>
            <span className="font-medium">{gpu.maxGraphicsClockMhz ?? '--'} MHz</span>
          </div>
          <div className="flex justify-between">
            <span>Max Memory</span>
            <span className="font-medium">{gpu.maxMemoryClockMhz ?? '--'} MHz</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function GpuProcessList({ processes }: { processes: GpuProcessInfo[] | null }) {
  if (!processes || processes.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No processes using GPU
      </div>
    );
  }

  return (
    <div className="rounded-lg border overflow-hidden">
      <table className="w-full text-xs">
        <thead className="bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left">PID</th>
            <th className="px-3 py-2 text-left">Process</th>
            <th className="px-3 py-2 text-left">Type</th>
            <th className="px-3 py-2 text-right">Memory</th>
            <th className="px-3 py-2 text-right">GPU %</th>
          </tr>
        </thead>
        <tbody>
          {processes.map((proc, idx) => (
            <tr key={idx} className="border-t">
              <td className="px-3 py-2 font-mono">{proc.processId}</td>
              <td className="px-3 py-2">{proc.processName || '--'}</td>
              <td className="px-3 py-2">
                <Badge variant="outline" className="text-[10px]">
                  {proc.usageType || 'Unknown'}
                </Badge>
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {formatBytes(proc.memoryUsedBytes)}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {proc.utilizationPercent?.toFixed(1) ?? '--'}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function EnhancedGpuPanel({ data }: EnhancedGpuPanelProps) {
  if (!data || data.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Cpu className="w-4 h-4" />
          Enhanced GPU Monitoring ({data.length} GPU{data.length > 1 ? 's' : ''})
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue={`gpu-${data[0].index}`} className="w-full">
          <TabsList className="mb-4">
            {data.map((gpu) => (
              <TabsTrigger key={gpu.index} value={`gpu-${gpu.index}`} className="text-xs">
                GPU {gpu.index}: {gpu.name?.split(' ').slice(0, 2).join(' ') || gpu.vendor}
              </TabsTrigger>
            ))}
          </TabsList>
          
          {data.map((gpu) => (
            <TabsContent key={gpu.index} value={`gpu-${gpu.index}`} className="space-y-4">
              <GpuOverviewCard gpu={gpu} />
              
              <div className="space-y-2">
                <h4 className="text-sm font-medium">Detailed Statistics</h4>
                <GpuDetailedStats gpu={gpu} />
              </div>
              
              <div className="space-y-2">
                <h4 className="text-sm font-medium">GPU Processes</h4>
                <GpuProcessList processes={gpu.processes} />
              </div>
              
              {/* Additional Info */}
              <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t">
                {gpu.uuid && <div>UUID: <span className="font-mono">{gpu.uuid}</span></div>}
                {gpu.pciBusId && <div>PCI Bus: <span className="font-mono">{gpu.pciBusId}</span></div>}
                {gpu.performanceState && <div>Performance State: {gpu.performanceState}</div>}
              </div>
            </TabsContent>
          ))}
        </Tabs>
      </CardContent>
    </Card>
  );
}
