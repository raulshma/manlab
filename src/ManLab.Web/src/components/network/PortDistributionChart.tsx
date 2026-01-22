import { useMemo } from "react";
import {
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getPortInfo, type ServiceCategory } from "@/components/network/PortCard";
import type { OpenPort } from "@/api/networkApi";

const CATEGORY_LABELS: Record<ServiceCategory, string> = {
  web: "Web",
  database: "Database",
  remote: "Remote",
  mail: "Mail",
  file: "File",
  other: "Other",
};

const CATEGORY_COLORS: Record<ServiceCategory, string> = {
  web: "#22c55e",
  database: "#3b82f6",
  remote: "#a855f7",
  mail: "#f97316",
  file: "#14b8a6",
  other: "#64748b",
};

interface PortDistributionChartProps {
  ports: OpenPort[];
}

export function PortDistributionChart({ ports }: PortDistributionChartProps) {
  const data = useMemo(() => {
    const counts: Record<ServiceCategory, number> = {
      web: 0,
      database: 0,
      remote: 0,
      mail: 0,
      file: 0,
      other: 0,
    };

    ports.forEach((port) => {
      const info = getPortInfo(port);
      counts[info.category] += 1;
    });

    return (Object.keys(counts) as ServiceCategory[])
      .map((category) => ({
        category,
        label: CATEGORY_LABELS[category],
        value: counts[category],
      }))
      .filter((item) => item.value > 0);
  }, [ports]);

  if (data.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">Port Distribution</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 md:grid-cols-[220px_1fr]">
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <RechartsTooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "0.5rem",
                }}
                labelStyle={{ color: "hsl(var(--foreground))" }}
              />
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={3}
              >
                {data.map((entry) => (
                  <Cell key={entry.category} fill={CATEGORY_COLORS[entry.category]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {data.map((entry) => (
            <div key={entry.category} className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: CATEGORY_COLORS[entry.category] }}
                />
                <span>{entry.label}</span>
              </div>
              <Badge variant="secondary" className="text-xs">
                {entry.value}
              </Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default PortDistributionChart;
