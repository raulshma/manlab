/**
 * TelemetryChart component for visualizing telemetry history.
 * Uses a simple SVG-based line chart for CPU, RAM, and Disk usage.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { Telemetry } from '../types';

interface TelemetryChartProps {
  data: Telemetry[];
  metric: 'cpuUsage' | 'ramUsage' | 'diskUsage';
  label: string;
  color: string;
}

/**
 * Formats a date string to a short time (e.g., "14:30").
 */
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * TelemetryChart displays a line graph of a telemetry metric over time.
 */
export function TelemetryChart({ data, metric, label, color }: TelemetryChartProps) {
  // Reverse data to show oldest first (left to right)
  const sortedData = [...data].reverse();
  
  // Chart dimensions
  const width = 400;
  const height = 120;
  const padding = { top: 20, right: 10, bottom: 30, left: 40 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Calculate data points
  const maxValue = 100; // Percentage
  const points = sortedData.map((item, index) => {
    const x = padding.left + (index / Math.max(sortedData.length - 1, 1)) * chartWidth;
    const y = padding.top + chartHeight - (item[metric] / maxValue) * chartHeight;
    return { x, y, value: item[metric], timestamp: item.timestamp };
  });

  // Create the line path
  const linePath = points.length > 0
    ? `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`
    : '';

  // Create the area path (for gradient fill)
  const areaPath = points.length > 0
    ? `M ${padding.left},${padding.top + chartHeight} L ${points.map(p => `${p.x},${p.y}`).join(' L ')} L ${points[points.length - 1]?.x ?? padding.left},${padding.top + chartHeight} Z`
    : '';

  // Current value (latest)
  const currentValue = sortedData.length > 0 ? sortedData[sortedData.length - 1][metric] : 0;

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-medium">{label}</CardTitle>
            <span className="text-lg font-bold" style={{ color }}>--</span>
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
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
          <span className="text-lg font-bold" style={{ color }}>
            {currentValue.toFixed(1)}%
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="xMidYMid meet">
          <defs>
            <linearGradient id={`gradient-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.3" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          
          {/* Grid lines */}
          {[0, 25, 50, 75, 100].map((value) => {
            const y = padding.top + chartHeight - (value / maxValue) * chartHeight;
            return (
              <g key={value}>
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
                  className="fill-muted-foreground text-[10px]"
                >
                  {value}
                </text>
              </g>
            );
          })}
          
          {/* Area fill */}
          <path d={areaPath} fill={`url(#gradient-${metric})`} />
          
          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          
          {/* Data points */}
          {points.map((point, index) => (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r="3"
              fill={color}
              className="opacity-0 hover:opacity-100 transition-opacity"
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
