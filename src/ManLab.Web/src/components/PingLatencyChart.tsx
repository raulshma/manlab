/**
 * PingLatencyChart component for visualizing ping RTT and packet loss.
 * Uses an SVG line chart with colored background regions for packet loss.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { PingTelemetryPoint } from '../types';

interface PingLatencyChartProps {
  data: PingTelemetryPoint[];
}

/**
 * Formats a date string to a short time (e.g., "14:30").
 */
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * PingLatencyChart displays ping RTT with packet loss visualization.
 */
export function PingLatencyChart({ data }: PingLatencyChartProps) {
  // Reverse data to show oldest first (left to right)
  const sortedData = [...data].reverse();
  
  // Chart dimensions
  const width = 400;
  const height = 140;
  const padding = { top: 20, right: 10, bottom: 30, left: 45 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Get max RTT for scaling (minimum 50ms for scale)
  const rttValues = sortedData.map(d => d.pingRttMs ?? 0).filter(v => v > 0);
  const maxRtt = Math.max(...rttValues, 50);

  // Calculate data points for RTT
  const rttPoints = sortedData.map((item, index) => {
    const x = padding.left + (index / Math.max(sortedData.length - 1, 1)) * chartWidth;
    const value = item.pingRttMs ?? 0;
    const y = value > 0 
      ? padding.top + chartHeight - (value / maxRtt) * chartHeight
      : padding.top + chartHeight; // Put at bottom if no data
    return { x, y, value, hasData: item.pingRttMs !== null };
  });

  // Create the line path (only for points with data)
  const segments: string[] = [];
  let currentSegment: { x: number; y: number }[] = [];
  
  for (const point of rttPoints) {
    if (point.hasData) {
      currentSegment.push({ x: point.x, y: point.y });
    } else {
      if (currentSegment.length > 0) {
        segments.push(`M ${currentSegment.map(p => `${p.x},${p.y}`).join(' L ')}`);
        currentSegment = [];
      }
    }
  }
  if (currentSegment.length > 0) {
    segments.push(`M ${currentSegment.map(p => `${p.x},${p.y}`).join(' L ')}`);
  }
  const linePath = segments.join(' ');

  // Current values (latest with data)
  const latestWithData = [...sortedData].reverse().find(d => d.pingRttMs !== null);
  const currentRtt = latestWithData?.pingRttMs ?? null;
  const currentLoss = latestWithData?.pingPacketLossPercent ?? null;
  const pingTarget = latestWithData?.pingTarget ?? 'Unknown';

  // Color for RTT line
  const rttColor = 'hsl(262, 83%, 58%)'; // Purple

  // Determine points where packet loss occurred
  const lossRegions: { startX: number; endX: number; loss: number }[] = [];
  for (let i = 0; i < sortedData.length; i++) {
    const loss = sortedData[i].pingPacketLossPercent ?? 0;
    if (loss > 0) {
      const x = padding.left + (i / Math.max(sortedData.length - 1, 1)) * chartWidth;
      const barWidth = chartWidth / Math.max(sortedData.length - 1, 1);
      lossRegions.push({ startX: x - barWidth / 2, endX: x + barWidth / 2, loss });
    }
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">Ping Latency</CardTitle>
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
          <CardTitle className="text-sm font-medium">Ping Latency</CardTitle>
          <div className="flex gap-4 text-xs">
            <span className="text-muted-foreground">
              Target: <span className="font-medium text-foreground">{pingTarget}</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">RTT:</span>
              <span className="font-medium" style={{ color: rttColor }}>
                {currentRtt !== null ? `${currentRtt.toFixed(1)}ms` : '--'}
              </span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Loss:</span>
              <span className={`font-medium ${currentLoss !== null && currentLoss > 0 ? 'text-destructive' : 'text-foreground'}`}>
                {currentLoss !== null ? `${currentLoss.toFixed(0)}%` : '--'}
              </span>
            </span>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id="gradient-rtt" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={rttColor} stopOpacity="0.3" />
              <stop offset="100%" stopColor={rttColor} stopOpacity="0" />
            </linearGradient>
          </defs>
          
          {/* Packet loss regions (background) */}
          {lossRegions.map((region, idx) => (
            <rect
              key={idx}
              x={Math.max(region.startX, padding.left)}
              y={padding.top}
              width={Math.min(region.endX - region.startX, chartWidth)}
              height={chartHeight}
              fill="hsl(0, 84%, 60%)"
              opacity={0.15 + (region.loss / 100) * 0.35}
            />
          ))}
          
          {/* Grid lines */}
          {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
            const y = padding.top + chartHeight * (1 - ratio);
            const value = maxRtt * ratio;
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
                  {value.toFixed(0)}ms
                </text>
              </g>
            );
          })}
          
          {/* RTT line */}
          <path
            d={linePath}
            fill="none"
            stroke={rttColor}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Data points */}
          {rttPoints.filter(p => p.hasData).map((point, index) => (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r="2.5"
              fill={rttColor}
              className="opacity-60"
            />
          ))}
          
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
