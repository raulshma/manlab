/**
 * SmartDrivePanel component for displaying SMART drive health status.
 * Shows health badges, temperature, and power-on hours per drive.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { SmartDriveSnapshot } from '../types';

interface SmartDrivePanelProps {
  data: SmartDriveSnapshot[];
}

/**
 * Formats power-on hours to human-readable format.
 */
function formatPowerOnTime(hours: number | null): string {
  if (hours === null) return '--';
  const days = Math.floor(hours / 24);
  const years = Math.floor(days / 365);
  if (years > 0) {
    const remainingDays = days % 365;
    return `${years}y ${remainingDays}d`;
  }
  if (days > 0) {
    return `${days}d ${hours % 24}h`;
  }
  return `${hours}h`;
}

/**
 * Formats a date string to relative time.
 */
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMinutes / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffMinutes < 1) return 'Just now';
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  return `${diffDays}d ago`;
}

/**
 * Gets the badge variant based on health status.
 */
function getHealthVariant(health: string): 'default' | 'destructive' | 'secondary' | 'outline' {
  switch (health.toLowerCase()) {
    case 'passed':
    case 'ok':
      return 'default';
    case 'failed':
    case 'failing':
      return 'destructive';
    default:
      return 'secondary';
  }
}

/**
 * SmartDrivePanel displays SMART status for all drives.
 */
export function SmartDrivePanel({ data }: SmartDrivePanelProps) {
  if (data.length === 0) {
    return null; // Don't render if no data
  }

  // Group by device and get the latest snapshot for each
  const latestByDevice = new Map<string, SmartDriveSnapshot>();
  for (const snapshot of data) {
    const existing = latestByDevice.get(snapshot.device);
    if (!existing || new Date(snapshot.timestamp) > new Date(existing.timestamp)) {
      latestByDevice.set(snapshot.device, snapshot);
    }
  }

  const drives = Array.from(latestByDevice.values()).sort((a, b) => 
    a.device.localeCompare(b.device)
  );

  // Get the most recent scan time
  const latestScan = drives.reduce((latest, drive) => {
    const driveTime = new Date(drive.timestamp);
    return driveTime > latest ? driveTime : latest;
  }, new Date(0));

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">SMART Drive Health</CardTitle>
          <span className="text-xs text-muted-foreground">
            Last scan: {formatRelativeTime(latestScan.toISOString())}
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {drives.map((drive) => (
            <div key={drive.device} className="flex items-center justify-between py-2 border-b border-border last:border-0">
              <div className="flex items-center gap-3">
                <code className="text-xs font-mono bg-muted px-2 py-0.5 rounded">
                  {drive.device}
                </code>
                <Badge variant={getHealthVariant(drive.health)}>
                  {drive.health}
                </Badge>
              </div>
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                {drive.temperatureC !== null && (
                  <span className={drive.temperatureC > 50 ? 'text-amber-500' : ''}>
                    🌡️ {drive.temperatureC}°C
                  </span>
                )}
                {drive.powerOnHours !== null && (
                  <span>
                    ⏱️ {formatPowerOnTime(drive.powerOnHours)}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
