/**
 * NetworkThroughputChart component for visualizing network Rx/Tx throughput.
 * Uses a dual-line SVG chart for receive and transmit bytes per second,
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
    Legend
} from "recharts";
import { format } from "date-fns";

import type { NetworkTelemetryPoint } from '../types';
import { fetchNodeNetworkTelemetry } from '../api';

interface NetworkThroughputChartProps {
  data: NetworkTelemetryPoint[];
  nodeId?: string;
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

function ExpandedNetworkChart({ nodeId }: { nodeId: string }) {
    const [count, setCount] = useState(300); 

    const { data: history, isLoading, isError, refetch } = useQuery({
        queryKey: ["networkTelemetry", nodeId, "history", count],
        queryFn: async () => {
            const data = await fetchNodeNetworkTelemetry(nodeId, count);
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
                            <linearGradient id="gradient-expanded-rx" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="hsl(142, 76%, 36%)" stopOpacity={0}/>
                            </linearGradient>
                            <linearGradient id="gradient-expanded-tx" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0.3}/>
                                <stop offset="95%" stopColor="hsl(221, 83%, 53%)" stopOpacity={0}/>
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
                            tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} 
                            axisLine={false}
                            tickLine={false}
                            tickFormatter={(v) => formatBytesPerSec(v)}
                            width={80}
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
                                                    {formatBytesPerSec(Number(p.value))}
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
                        <Area 
                            name="Rx (Download)"
                            type="monotone" 
                            dataKey="netRxBytesPerSec" 
                            stroke="hsl(142, 76%, 36%)" 
                            fill="url(#gradient-expanded-rx)" 
                            strokeWidth={2}
                            animationDuration={500}
                        />
                        <Area 
                            name="Tx (Upload)"
                            type="monotone" 
                            dataKey="netTxBytesPerSec" 
                            stroke="hsl(221, 83%, 53%)" 
                            fill="url(#gradient-expanded-tx)" 
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
 * NetworkThroughputChart displays dual-line chart for Rx/Tx throughput.
 */
export function NetworkThroughputChart({ data, nodeId }: NetworkThroughputChartProps) {
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
          <CardTitle className="text-sm font-medium">Network Throughput</CardTitle>
          <div className="flex items-center justify-between gap-4">
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
                                Network Throughput History
                                <span className="text-sm font-normal text-muted-foreground px-2 py-0.5 rounded-full bg-muted">Live</span>
                            </DialogTitle>
                            <DialogDescription>
                                High-resolution historical network traffic data.
                            </DialogDescription>
                        </DialogHeader>
                        <ExpandedNetworkChart nodeId={nodeId} />
                    </DialogContent>
                 </Dialog>
             )}
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
