/**
 * TelemetryChart component for visualizing telemetry history.
 * Uses a simple SVG-based line chart for CPU, RAM, and Disk usage,
 * with an expanded modal view using Recharts for deeper history.
 */

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogDescription,
} from "@/components/ui/dialog";
import { Maximize2, Loader2, RefreshCw } from "lucide-react";
import {
    Area,
    AreaChart,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from "recharts";
import { format } from "date-fns";

import type { Telemetry } from '../types';
import { fetchNodeTelemetry } from '../api';

interface TelemetryChartProps {
  data: Telemetry[];
  metric: 'cpuUsage' | 'ramUsage' | 'diskUsage';
  label: string;
  color: string;
  nodeId?: string;
}

/**
 * Formats a date string to a short time (e.g., "14:30").
 */
function formatTime(value: unknown): string {
  try {
     if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
         const date = new Date(value);
         if (isNaN(date.getTime())) return "";
         return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
     }
     return "";
  } catch {
      return "";
  }
}

function formatFullTime(value: unknown): string {
    try {
        if (typeof value === 'string' || typeof value === 'number' || value instanceof Date) {
            const date = new Date(value);
            if (isNaN(date.getTime())) return String(value);
            return format(date, "PPpp");
        }
        return String(value);
    } catch {
        return String(value);
    }
}

function ExpandedTelemetryChart({ nodeId, metric, color }: { nodeId: string; metric: TelemetryChartProps['metric']; color: string }) {
    const [count, setCount] = useState(300); // Fetch last 300 points (approx 50 mins at 10s interval)

    const { data: history, isLoading, isError, refetch } = useQuery({
        queryKey: ["telemetry", nodeId, "history", count],
        queryFn: async () => {
            const data = await fetchNodeTelemetry(nodeId, count);
            // Reverse so graph is left-to-right (oldest -> newest) because API returns desc?
            // Existing code reversed it. Let's assume API returns desc (newest first).
            return [...data].reverse(); 
        },
        staleTime: 10000,
    });

    if (isLoading) {
        return <div className="h-[400px] flex items-center justify-center flex-col gap-2 text-muted-foreground">
            <Loader2 className="h-8 w-8 animate-spin" />
            Loading history...
        </div>;
    }

    if (isError) {
        return <div className="h-[400px] flex items-center justify-center text-destructive">Failed to load history data.</div>;
    }

    const data = history || [];

    return (
        <div className="space-y-4">
             <div className="flex items-center justify-between">
                <div className="flex gap-2">
                    <Button variant={count === 180 ? "secondary" : "outline"} size="sm" onClick={() => setCount(180)}>30 Min</Button>
                    <Button variant={count === 360 ? "secondary" : "outline"} size="sm" onClick={() => setCount(360)}>1 Hour</Button>
                    <Button variant={count === 1000 ? "secondary" : "outline"} size="sm" onClick={() => setCount(1000)}>3 Hours</Button>
                </div>
                <Button variant="ghost" size="sm" onClick={() => refetch()} disabled={isLoading}>
                    <RefreshCw className={isLoading ? "animate-spin" : ""} size={16} />
                </Button>
             </div>

             <div className="h-[400px] w-full border rounded-lg bg-card/50 p-4">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                        <defs>
                            <linearGradient id={`gradient-expanded-${metric}`} x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor={color} stopOpacity={0.3}/>
                                <stop offset="95%" stopColor={color} stopOpacity={0}/>
                            </linearGradient>
                        </defs>
                        <CartesianGrid vertical={false} strokeDasharray="3 3" opacity={0.1} />
                        <XAxis 
                            dataKey="timestamp" 
                            tickFormatter={formatTime} 
                            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} 
                            minTickGap={50}
                            axisLine={false}
                            tickLine={false}
                        />
                        <YAxis 
                            domain={[0, 100]} 
                            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `${v}%`}
                        />
                        <Tooltip
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                return (
                                    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md animate-in fade-in-0 zoom-in-95">
                                        <div className="mb-1 font-medium">{formatFullTime(label)}</div>
                                        <div className="flex items-center gap-2">
                                            <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                                            <span className="text-muted-foreground">{label}:</span>
                                            <span className="font-mono font-medium">
                                                {Number(payload[0].value).toFixed(1)}%
                                            </span>
                                        </div>
                                    </div>
                                )
                                }
                                return null
                            }}
                        />
                        <Area 
                            type="monotone" 
                            dataKey={metric} 
                            stroke={color} 
                            fill={`url(#gradient-expanded-${metric})`} 
                            strokeWidth={2}
                            animationDuration={500}
                        />
                    </AreaChart>
                </ResponsiveContainer>
             </div>
             
             <div className="flex justify-between items-center text-sm text-muted-foreground px-2">
                <span>Start: {data.length > 0 ? formatFullTime(data[0].timestamp) : '-'}</span>
                <span>End: {data.length > 0 ? formatFullTime(data[data.length - 1].timestamp) : '-'}</span>
             </div>
        </div>
    );
}

/**
 * TelemetryChart displays a line graph of a telemetry metric over time.
 */
export function TelemetryChart({ data, metric, label, color, nodeId }: TelemetryChartProps) {
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
  
  // No data view
  if (data.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-medium">{label}</CardTitle>
                <div className="flex items-center gap-2">
                    <span className="text-lg font-bold" style={{ color }}>—</span>
                    {nodeId && <Button variant="ghost" size="icon" className="h-6 w-6 opacity-50 cursor-not-allowed"><Maximize2 className="h-3 w-3" /></Button>}
                </div>
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
    <Card className="transition-all hover:shadow-md">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-medium">{label}</CardTitle>
          <div className="flex items-center gap-2">
             <span className="text-lg font-bold tabular-nums" style={{ color }}>
                {currentValue.toFixed(1)}%
             </span>
             {nodeId && (
                 <Dialog>
                    <DialogTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground">
                            <Maximize2 className="h-3 w-3" />
                        </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-4xl">
                        <DialogHeader>
                            <DialogTitle className="text-xl flex items-center gap-2">
                                {label} History
                                <span className="text-sm font-normal text-muted-foreground px-2 py-0.5 rounded-full bg-muted">Live</span>
                            </DialogTitle>
                            <DialogDescription>
                                High-resolution historical telemetry data.
                            </DialogDescription>
                        </DialogHeader>
                        <ExpandedTelemetryChart nodeId={nodeId} metric={metric} color={color} />
                    </DialogContent>
                 </Dialog>
             )}
          </div>
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
          <path d={areaPath} fill={`url(#gradient-${metric})`} className="transition-all duration-300" />
          
          {/* Line */}
          <path
            d={linePath}
            fill="none"
            stroke={color}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="transition-all duration-300"
          />
          
          {/* Data points (only show specific ones to avoid clutter if needed, or all) */}
          {points.map((point, index) => (
            <circle
              key={index}
              cx={point.x}
              cy={point.y}
              r="3"
              fill={color}
              className="opacity-0 hover:opacity-100 transition-opacity duration-200 cursor-crosshair"
            >
               <title>{`${point.value.toFixed(1)}% at ${formatTime(point.timestamp)}`}</title>
            </circle>
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
