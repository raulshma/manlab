import { useMemo } from "react";
import { Cell, Pie, PieChart, Tooltip as RechartsTooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { ChartContainer, type ChartConfig } from "@/components/ui/chart";
import { Activity, Server } from "lucide-react";
import type { Node } from "@/types";

interface FleetHealthChartProps {
  nodes: Node[];
  isLoading?: boolean;
}

const statusPieConfig: ChartConfig = {
  Online: { label: "Online", color: "var(--chart-2)" },
  Offline: { label: "Offline", color: "var(--chart-5)" },
  Error: { label: "Error", color: "var(--destructive)" },
  Other: { label: "Other", color: "var(--muted-foreground)" },
};

function isStatusPayload(x: unknown): x is { name: string; value: number } {
  if (!x || typeof x !== "object") return false;
  const obj = x as Record<string, unknown>;
  return typeof obj.name === "string" && typeof obj.value === "number";
}

/**
 * Fleet health donut chart showing node status distribution.
 */
export function FleetHealthChart({ nodes, isLoading }: FleetHealthChartProps) {
  const statusData = useMemo(() => {
    const online = nodes.filter((n) => n.status === "Online").length;
    const offline = nodes.filter((n) => n.status === "Offline").length;
    const error = nodes.filter((n) => n.status === "Error").length;
    const other = Math.max(0, nodes.length - online - offline - error);

    return [
      { name: "Online", value: online, color: "var(--chart-2)" },
      { name: "Offline", value: offline, color: "var(--chart-5)" },
      { name: "Error", value: error, color: "var(--destructive)" },
      { name: "Other", value: other, color: "var(--muted-foreground)" },
    ].filter((x) => x.value > 0);
  }, [nodes]);

  const totalNodes = nodes.length;
  const onlineNodes = nodes.filter((n) => n.status === "Online").length;
  const uptimePercent = totalNodes > 0 ? Math.round((onlineNodes / totalNodes) * 100) : 0;

  if (isLoading) {
    return (
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Fleet Health
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[280px]">
          <div className="h-44 w-44 rounded-full bg-muted/50 animate-pulse" />
        </CardContent>
      </Card>
    );
  }

  if (totalNodes === 0) {
    return (
      <Card className="border shadow-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            Fleet Health
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col items-center justify-center h-[280px] text-center">
          <div className="p-4 rounded-full bg-muted/50 mb-3">
            <Server className="h-8 w-8 text-muted-foreground" />
          </div>
          <p className="text-sm font-medium text-muted-foreground">No nodes registered</p>
          <p className="text-xs text-muted-foreground/70 mt-1">
            Onboard a machine to get started
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border shadow-sm">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4 text-muted-foreground" />
          Fleet Health
        </CardTitle>
        <CardDescription>
          {uptimePercent}% uptime across {totalNodes} node{totalNodes !== 1 ? "s" : ""}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex items-center justify-center">
        <ChartContainer id="fleet-health" config={statusPieConfig} className="h-[250px] w-full max-w-[250px]">
          <PieChart>
            <RechartsTooltip
              cursor={false}
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null;
                const raw = payload[0].payload as unknown;
                if (!isStatusPayload(raw)) return null;

                return (
                  <div className="rounded-lg border bg-popover px-3 py-2 text-sm shadow-md animate-in fade-in-0 zoom-in-95">
                    <h5 className="font-medium text-popover-foreground mb-1">{raw.name}</h5>
                    <div className="text-muted-foreground">{raw.value} node{raw.value !== 1 ? "s" : ""}</div>
                  </div>
                );
              }}
            />
            <Pie
              data={statusData}
              dataKey="value"
              nameKey="name"
              innerRadius={70}
              outerRadius={100}
              paddingAngle={3}
              stroke="none"
            >
              {statusData.map((entry) => (
                <Cell
                  key={entry.name}
                  fill={entry.color}
                  className="stroke-background hover:opacity-80 transition-opacity"
                  strokeWidth={3}
                />
              ))}
            </Pie>
            <text
              x="50%"
              y="46%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-foreground text-3xl font-bold"
            >
              {totalNodes}
            </text>
            <text
              x="50%"
              y="58%"
              textAnchor="middle"
              dominantBaseline="middle"
              className="fill-muted-foreground text-xs font-medium"
            >
              Total Nodes
            </text>
          </PieChart>
        </ChartContainer>
      </CardContent>
    </Card>
  );
}
