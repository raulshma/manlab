/**
 * UpsStatusPanel component for displaying UPS battery, load, and status.
 * Shows battery percentage, load, on-battery status, and estimated runtime.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { AlertCircle } from 'lucide-react';
import type { UpsSnapshot } from '../types';

interface UpsStatusPanelProps {
  data: UpsSnapshot[];
}

/**
 * Formats seconds to human-readable runtime.
 */
function formatRuntime(seconds: number | null): string {
  if (seconds === null) return '--';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMins = minutes % 60;
  return `${hours}h ${remainingMins}m`;
}

/**
 * UpsStatusPanel displays UPS status information.
 */
export function UpsStatusPanel({ data }: UpsStatusPanelProps) {
  if (data.length === 0) {
    return null; // Don't render if no data
  }

  // Get the latest snapshot
  const latestSnapshot = data.reduce((latest, current) => {
    return new Date(current.timestamp) > new Date(latest.timestamp) ? current : latest;
  }, data[0]);

  const { batteryPercent, loadPercent, onBattery, estimatedRuntimeSeconds, backend } = latestSnapshot;

  // Determine battery status color
  const batteryColor = 
    batteryPercent === null ? 'text-muted-foreground' :
    batteryPercent < 20 ? 'text-destructive' :
    batteryPercent < 50 ? 'text-amber-500' :
    'text-emerald-500';

  return (
    <Card className={onBattery ? 'border-amber-500/50' : ''}>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            UPS Status
            {onBattery && (
              <Badge variant="destructive" className="flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                On Battery
              </Badge>
            )}
          </CardTitle>
          <span className="text-xs text-muted-foreground">
            via {backend}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-6">
          {/* Battery */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Battery</span>
              <span className={`font-medium ${batteryColor}`}>
                {batteryPercent !== null ? `${batteryPercent.toFixed(0)}%` : '--'}
              </span>
            </div>
            <Progress 
              value={batteryPercent ?? 0} 
              className="h-2"
            />
          </div>

          {/* Load */}
          <div className="space-y-2">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Load</span>
              <span className={`font-medium ${loadPercent !== null && loadPercent > 80 ? 'text-amber-500' : ''}`}>
                {loadPercent !== null ? `${loadPercent.toFixed(0)}%` : '--'}
              </span>
            </div>
            <Progress 
              value={loadPercent ?? 0} 
              className="h-2"
            />
          </div>
        </div>

        {/* Estimated Runtime */}
        {estimatedRuntimeSeconds !== null && (
          <div className="mt-4 pt-3 border-t border-border">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">Estimated Runtime</span>
              <span className="font-medium">
                {formatRuntime(estimatedRuntimeSeconds)}
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
