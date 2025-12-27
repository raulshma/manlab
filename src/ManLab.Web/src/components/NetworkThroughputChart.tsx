/**
 * NetworkThroughputChart component for visualizing network Rx/Tx throughput.
 * Uses a dual-line SVG chart for receive and transmit bytes per second.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { NetworkTelemetryPoint } from '../types';

interface NetworkThroughputChartProps {
  data: NetworkTelemetryPoint[];
}

/**
 * Formats bytes per second to human-readable units.
 */
function formatBytesPerSec(bytesPerSec: number | null): string {
  if (bytesPerSec === null || bytesPerSec === undefined) return '--';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

/**
 * Formats a date string to a short time (e.g., "14:30").
 */
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * NetworkThroughputChart displays dual-line chart for Rx/Tx throughput.
 */
export function NetworkThroughputChart({ data }: NetworkThroughputChartProps) {
  // Reverse data to show oldest first (left to right)
  const sortedData = [...data].reverse();
  
  // Chart dimensions
  const width = 400;
  const height = 140;
  const padding = { top: 20, right: 10, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Get max value for scaling
  const allValues = sortedData.flatMap(d => [d.netRxBytesPerSec ?? 0, d.netTxBytesPerSec ?? 0]);
  const maxValue = Math.max(...allValues, 1024); // Minimum 1KB for scale

  // Calculate data points for Rx
  const rxPoints = sortedData.map((item, index) => {
    const x = padding.left + (index / Math.max(sortedData.length - 1, 1)) * chartWidth;
    const value = item.netRxBytesPerSec ?? 0;
    const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
    return { x, y, value };
  });

  // Calculate data points for Tx
  const txPoints = sortedData.map((item, index) => {
    const x = padding.left + (index / Math.max(sortedData.length - 1, 1)) * chartWidth;
    const value = item.netTxBytesPerSec ?? 0;
    const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
    return { x, y, value };
  });

  // Create line paths
  const rxLinePath = rxPoints.length > 0
    ? `M ${rxPoints.map(p => `${p.x},${p.y}`).join(' L ')}`
    : '';
  const txLinePath = txPoints.length > 0
    ? `M ${txPoints.map(p => `${p.x},${p.y}`).join(' L ')}`
    : '';

  // Current values (latest)
  const currentRx = sortedData.length > 0 ? sortedData[sortedData.length - 1].netRxBytesPerSec : null;
  const currentTx = sortedData.length > 0 ? sortedData[sortedData.length - 1].netTxBytesPerSec : null;

  // Colors
  const rxColor = 'hsl(142, 76%, 36%)'; // Green for download
  const txColor = 'hsl(221, 83%, 53%)'; // Blue for upload

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Network Throughput</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-20 text-muted-foreground text-sm">
            No data available
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">Network Throughput</CardTitle>
          <div className="flex gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: rxColor }} />
              <span className="text-muted-foreground">Rx:</span>
              <span className="font-medium" style={{ color: rxColor }}>{formatBytesPerSec(currentRx)}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full" style={{ backgroundColor: txColor }} />
              <span className="text-muted-foreground">Tx:</span>
              <span className="font-medium" style={{ color: txColor }}>{formatBytesPerSec(currentTx)}</span>
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="gradient-rx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rxColor} stopOpacity="0.2" />
              <stop offset="100%" stopColor={rxColor} stopOpacity="0" />
            </linearGradient>
            <linearGradient id="gradient-tx" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={txColor} stopOpacity="0.2" />
              <stop offset="100%" stopColor={txColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
            const y = padding.top + chartHeight * (1 - ratio);
            const value = maxValue * ratio;
            return (
              <g key={idx}>
                <line
                  x1={padding.left}
                  y1={y}
                  x2={width - padding.right}
                  y2={y}
                  className="stroke-border"
                  strokeWidth="1"
                  strokeDasharray="4,4"
                />
                <text
                  x={padding.left - 5}
                  y={y + 4}
                  textAnchor="end"
                  className="fill-muted-foreground text-[9px]"
                >
                  {formatBytesPerSec(value).split(' ')[0]}
                </text>
              </g>
            );
          })}
          
          {/* Rx area fill */}
          {rxPoints.length > 0 && (
            <path
              d={`M ${padding.left},${padding.top + chartHeight} L ${rxPoints.map(p => `${p.x},${p.y}`).join(' L ')} L ${rxPoints[rxPoints.length - 1]?.x ?? padding.left},${padding.top + chartHeight} Z`}
              fill="url(#gradient-rx)"
            />
          )}
          
          {/* Tx area fill */}
          {txPoints.length > 0 && (
            <path
              d={`M ${padding.left},${padding.top + chartHeight} L ${txPoints.map(p => `${p.x},${p.y}`).join(' L ')} L ${txPoints[txPoints.length - 1]?.x ?? padding.left},${padding.top + chartHeight} Z`}
              fill="url(#gradient-tx)"
            />
          )}
          
          {/* Rx line */}
          <path
            d={rxLinePath}
            fill="none"
            stroke={rxColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Tx line */}
          <path
            d={txLinePath}
            fill="none"
            stroke={txColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Time labels */}
          {sortedData.length > 0 && (
            <>
              <text
                x={padding.left}
                y={height - 5}
                textAnchor="start"
                className="fill-muted-foreground text-[10px]"
              >
                {formatTime(sortedData[0].timestamp)}
              </text>
              <text
                x={width - padding.right}
                y={height - 5}
                textAnchor="end"
                className="fill-muted-foreground text-[10px]"
              >
                {formatTime(sortedData[sortedData.length - 1].timestamp)}
              </text>
            </>
          )}
        </svg>
      </CardContent>
    </Card>
  );
}
