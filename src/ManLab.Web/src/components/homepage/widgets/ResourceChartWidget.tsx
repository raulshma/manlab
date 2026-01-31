import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BarChart3, RefreshCw } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";
import type { TelemetryHistoryPoint } from "@/types";
import { fetchNodes, fetchNodeTelemetryHistory } from "@/api";

export const ResourceChartWidget = memo(function ResourceChartWidget({ config, onConfigChange }: WidgetProps) {
  const nodeId = (config.nodeId as string) || "";
  const metrics = (config.metrics as string[]) || ["cpu", "ram"];
  const timeRange = (config.timeRange as string) || "24h";
  const widgetHeight = (config.height as number) || 2;

  const { data: nodes } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
  });

  const { data: history, isLoading: historyLoading, refetch } = useQuery({
    queryKey: ["telemetryHistory", nodeId, timeRange],
    queryFn: () => {
      if (!nodeId) return Promise.resolve(null);

      const now = new Date();
      let fromUtc = "";

      switch (timeRange) {
        case "1h":
          fromUtc = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
          break;
        case "6h":
          fromUtc = new Date(now.getTime() - 6 * 60 * 60 * 1000).toISOString();
          break;
        case "12h":
          fromUtc = new Date(now.getTime() - 12 * 60 * 60 * 1000).toISOString();
          break;
        case "24h":
          fromUtc = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
          break;
        case "48h":
          fromUtc = new Date(now.getTime() - 48 * 60 * 60 * 1000).toISOString();
          break;
        default:
          fromUtc = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
      }

      return fetchNodeTelemetryHistory(nodeId, {
          fromUtc,
          toUtc: new Date().toISOString()
      });
    },
    enabled: !!nodeId,
    staleTime: 60_000,
  });

  const selectedNode = nodes?.find((n) => n.id === nodeId);

  const getTimeRangeLabel = (range: string): string => {
    const labels: Record<string, string> = {
      "1h": "1 Hour",
      "6h": "6 Hours",
      "12h": "12 Hours",
      "24h": "24 Hours",
      "48h": "48 Hours",
    };
    return labels[range] || range;
  };

  if (!nodeId) {
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-muted-foreground/70">
          <BarChart3 className="h-4 w-4" />
          <span className="text-sm">Select a node to display resource history</span>
        </div>
      </div>
    );
  }

  if (historyLoading) {
    return (
      <Card className="border">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <CardTitle className="text-lg">Resource History</CardTitle>
              <div className="flex items-center gap-2">
                {selectedNode && (
                  <div className="text-sm text-muted-foreground/70">
                    {selectedNode.hostname} • {selectedNode.os}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Select value={nodeId} onValueChange={(value) => {
                  if (value && value !== nodeId) {
                     onConfigChange({ ...config, nodeId: value });
                  }
                }}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Select Node" />
                  </SelectTrigger>
                  <SelectContent>
                    {nodes?.map((n) => (
                      <SelectItem key={n.id} value={n.id}>
                        {n.hostname}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <RefreshCw
                  className="h-4 w-4 cursor-pointer"
                  onClick={() => {
                    if (nodeId) {
                      refetch();
                    }
                  }}
                />
                <Select value={timeRange} onValueChange={(value) => {
                  if (value && value !== timeRange) {
                    onConfigChange({ ...config, timeRange: value });
                  }
                }}>
                  <SelectTrigger className="w-[120px]">
                    <SelectValue placeholder="Time Range" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1h">{getTimeRangeLabel("1h")}</SelectItem>
                    <SelectItem value="6h">{getTimeRangeLabel("6h")}</SelectItem>
                    <SelectItem value="12h">{getTimeRangeLabel("12h")}</SelectItem>
                    <SelectItem value="24h">{getTimeRangeLabel("24h")}</SelectItem>
                    <SelectItem value="48h">{getTimeRangeLabel("48h")}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center h-[200px] text-muted-foreground/70">
            <BarChart3 className="h-8 w-8 animate-spin" />
            <span className="ml-2 text-sm">Loading chart...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (history && history.points.length === 0) {
    return (
      <Card className="border">
        <CardHeader>
          <CardTitle>Resource History</CardTitle>
        </CardHeader>
        <CardContent className="p-4">
          <div className="flex items-center justify-center py-8 text-muted-foreground/70">
            <BarChart3 className="h-12 w-12 text-muted-foreground/50" />
            <p className="ml-2 text-sm">No telemetry data available for this node</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border" style={{ height: `${widgetHeight * 200}px` }}>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="space-y-1">
            <CardTitle className="text-lg">Resource History</CardTitle>
            <div className="flex items-center gap-2 text-sm text-muted-foreground/70">
              {selectedNode && (
                <>
                  {selectedNode.hostname} • {selectedNode.os}
                  • {getTimeRangeLabel(timeRange)}
                </>
              )}
              {!selectedNode && <span>Select a node</span>}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground/70">Showing</span>
              <span className="font-medium">{metrics.join(" + ").toUpperCase()}</span>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-4">
        <div className="h-full">
          {history && history.points.length > 0 && <ResourceChart data={history.points} metrics={metrics} />}
        </div>
      </CardContent>
    </Card>
  );
});

function ResourceChart({ data, metrics }: { data: TelemetryHistoryPoint[]; metrics: string[] }) {
  const chartData = prepareChartData(data, metrics);

  return (
    <div className="h-full w-full">
      <svg
        viewBox="0 0 400 200"
        className="w-full h-full"
        preserveAspectRatio="none"
      >
        <text
          x="10"
          y="180"
          className="text-sm font-semibold fill-foreground"
        >
          Resource Usage Over Time
        </text>

        {chartData.cpu && (
          <g>
            <path
              d={chartData.cpu.path}
              fill="none"
              stroke="#3b82f6"
              strokeWidth={2}
            />
            <circle
              cx="350"
              cy={chartData.cpu.maxY - 20}
              r="4"
              fill="#3b82f6"
              className="opacity-20"
            />
            {chartData.cpu.labels.map((label, index) => (
              <text
                key={index}
                x={chartData.cpu!.labelX[index]}
                y={chartData.cpu!.labelY[index]}
                className="text-xs fill-foreground"
                textAnchor="middle"
              >
                {label}
              </text>
            ))}
          </g>
        )}

        {chartData.ram && (
          <g>
            <path
              d={chartData.ram.path}
              fill="none"
              stroke="#a855f7"
              strokeWidth={2}
            />
            <circle
              cx={350}
              cy={chartData.ram.maxY - 20}
              r="4"
              fill="#a855f7"
              className="opacity-20"
            />
            {chartData.ram.labels.map((label, index) => (
              <text
                key={index}
                x={chartData.ram!.labelX[index]}
                y={chartData.ram!.labelY[index]}
                className="text-xs fill-foreground"
                textAnchor="middle"
              >
                {label}
              </text>
            ))}
          </g>
        )}
      </svg>
    </div>
  );
}

function prepareChartData(data: TelemetryHistoryPoint[], metrics: string[]) {
  const result: Record<string, {
    path: string;
    labels: string[];
    labelX: number[];
    labelY: number[];
    maxY: number;
  } | null> = {
    cpu: null,
    ram: null,
  };

  const margin = { top: 40, right: 20, bottom: 60, left: 50 };
  const chartWidth = 400 - margin.left - margin.right;
  const chartHeight = 200 - margin.top - margin.bottom;

  const sortedData = [...data].sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  const cpuEnabled = metrics.includes("cpu");
  const ramEnabled = metrics.includes("ram");

  if (sortedData.length === 0) {
    return result;
  }

  if (cpuEnabled) {
    const cpuValues = sortedData.map((d) => d.cpuAvg || 0);
    const maxCpu = Math.max(...cpuValues, 100);
    const cpuY = chartHeight - margin.top - margin.bottom - (maxCpu / 100) * chartHeight;

    const cpuLabels = cpuValues.map((v) => `${v.toFixed(1)}%`);

    result.cpu = {
      path: generateLinePath(sortedData.map((d) => ({
        x: margin.left + (sortedData.indexOf(d) / (sortedData.length - 1)) * chartWidth,
        y: cpuY - (d.cpuAvg || 0) / 100 * chartHeight,
      }))),
      labels: cpuLabels,
      labelX: cpuLabels.map((_, i) => margin.left + (i / (cpuLabels.length - 1)) * chartWidth),
      labelY: cpuLabels.map(() => cpuY + 20),
      maxY: chartHeight - margin.top - margin.bottom,
    };
  }

  if (ramEnabled) {
    // Assuming ramAvg is percent
    const ramValues = sortedData.map((d) => d.ramAvg || 0);

    const maxRam = Math.max(...ramValues, 100);
    const ramY = chartHeight - margin.top - margin.bottom - (maxRam / 100) * chartHeight;

    const ramLabels = ramValues.map((v) => `${v.toFixed(1)}%`);

    result.ram = {
      path: generateLinePath(sortedData.map((d) => ({
        x: margin.left + (sortedData.indexOf(d) / (sortedData.length - 1)) * chartWidth,
        y: ramY - (ramValues[sortedData.indexOf(d)] / 100) * chartHeight,
      }))),
      labels: ramLabels,
      labelX: ramLabels.map((_, i) => margin.left + (i / (ramLabels.length - 1)) * chartWidth),
      labelY: ramLabels.map(() => ramY + 20),
      maxY: chartHeight - margin.top - margin.bottom,
    };
  }

  return result;
}

function generateLinePath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return "";

  let path = `M ${points[0].x},${points[0].y}`;

  for (let i = 1; i < points.length; i++) {
    const cp1 = points[i - 1];
    const cp2 = points[i];

    const midX = (cp1.x + cp2.x) / 2;
    const midY = (cp1.y + cp2.y) / 2;

    path += ` L ${midX},${midY}`;

    for (let j = 0; j <= 4; j++) {
      const xc = cp1.x + (j / 5) * (cp2.x - cp1.x);
      const yc = cp1.y + (j / 5) * (cp2.y - cp1.y);
      path += ` ${xc},${yc}`;
    }
  }

  const lastPoint = points[points.length - 1];
  path += ` L ${lastPoint.x},${lastPoint.y}`;

  return path;
}
