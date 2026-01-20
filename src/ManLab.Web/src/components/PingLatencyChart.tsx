/**
 * PingLatencyChart component for visualizing ping RTT and packet loss.
 * Uses an SVG line chart for small view, and Recharts ComposedChart for detailed view.
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
    ComposedChart,
    Line,
    Bar,
    CartesianGrid,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
    Legend
} from "recharts";
import { format } from "date-fns";

import type { PingTelemetryPoint } from '../types';
import { fetchNodePingTelemetry } from '../api';

interface PingLatencyChartProps {
  data: PingTelemetryPoint[];
  nodeId?: string;
}

/**
 * Formats a date string to a short time (e.g., "14:30").
 */
function formatTime(dateString: string): string {
    try {
        const date = new Date(dateString);
        return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ""; }
}

function formatFullTime(dateString: string): string {
    try {
        return format(new Date(dateString), "PPpp");
    } catch { return dateString; }
}

function ExpandedPingChart({ nodeId }: { nodeId: string }) {
    const [count, setCount] = useState(300); 

    const { data: history, isLoading, isError, refetch } = useQuery({
        queryKey: ["pingTelemetry", nodeId, "history", count],
        queryFn: async () => {
            const data = await fetchNodePingTelemetry(nodeId, count);
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
                    <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
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
                            yAxisId="left"
                            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `${v}ms`}
                            label={{ value: 'Latency (ms)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fill: 'var(--muted-foreground)', opacity: 0.5 } }}
                        />
                         <YAxis 
                            yAxisId="right"
                            orientation='right'
                            domain={[0, 100]}
                            tick={{ fontSize: 12, fill: "var(--destructive)" }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => `${v}%`}
                            hide={data.every(d => (d.pingPacketLossPercent ?? 0) === 0)}
                        />
                         <Tooltip
                            content={({ active, payload, label }) => {
                                if (active && payload && payload.length) {
                                return (
                                    <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md animate-in fade-in-0 zoom-in-95">
                                        <div className="mb-1 font-medium">{formatFullTime(label)}</div>
                                        {payload.map((p, idx) => (
                                            <div key={idx} className="flex items-center gap-2">
                                                <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
                                                <span className="text-muted-foreground">{p.name}:</span>
                                                <span className="font-mono font-medium">
                                                    {Number(p.value).toFixed(1)}
                                                    {p.dataKey === 'pingPacketLossPercent' ? '%' : 'ms'}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )
                                }
                                return null
                            }}
                        />
                        <Legend />
                        <Bar
                            yAxisId="right"
                            name="Packet Loss"
                            dataKey="pingPacketLossPercent"
                            fill="hsl(var(--destructive))"
                            opacity={0.5}
                            barSize={4}
                        />
                        <Line 
                            yAxisId="left"
                            name="Latency (RTT)"
                            type="monotone" 
                            dataKey="pingRttMs" 
                            stroke="hsl(262, 83%, 58%)" 
                            strokeWidth={2}
                            dot={false}
                            connectNulls
                        />
                    </ComposedChart>
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
 * PingLatencyChart displays ping RTT with packet loss visualization.
 */
export function PingLatencyChart({ data, nodeId }: PingLatencyChartProps) {
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
            {nodeId && <Button variant="ghost" size="icon" className="h-6 w-6 opacity-50 cursor-not-allowed"><Maximize2 className="h-3 w-3" /></Button>}
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
          <CardTitle className="text-sm font-medium">Ping Latency</CardTitle>
          <div className="flex items-center gap-4 text-xs">
            <span className="text-muted-foreground">
               <span className="font-medium text-foreground">{pingTarget}</span>
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
                                Ping Latency History
                                <span className="text-sm font-normal text-muted-foreground px-2 py-0.5 rounded-full bg-muted">Live</span>
                            </DialogTitle>
                            <DialogDescription>
                                High-resolution historical latency and packet loss data.
                            </DialogDescription>
                        </DialogHeader>
                        <ExpandedPingChart nodeId={nodeId} />
                    </DialogContent>
                 </Dialog>
             )}
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
