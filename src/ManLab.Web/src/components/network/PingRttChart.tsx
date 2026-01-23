import {
  Line,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  ReferenceLine,
  AreaChart,
  Area,
} from "recharts";

interface PingRttChartProps {
  data: Array<{ time: string; rtt: number; minRtt?: number; maxRtt?: number }>;
  avgRtt: number;
}

export default function PingRttChart({ data, avgRtt }: PingRttChartProps) {
  if (data.length === 0) {
    return null;
  }

  return (
    <div className="h-[250px] w-full p-4 pl-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data}>
          <defs>
            <linearGradient id="rttGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.2} />
              <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="time"
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickMargin={10}
            minTickGap={30}
          />
          <YAxis
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(value) => `${value}ms`}
            width={40}
            domain={['auto', 'auto']}
          />
          <RechartsTooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="rounded-lg border bg-popover p-2 shadow-sm">
                    <div className="grid grid-cols-2 gap-2">
                      <div className="flex flex-col">
                        <span className="text-[0.70rem] uppercase text-muted-foreground">
                          RTT
                        </span>
                        <span className="font-bold text-foreground">
                          {payload[0].value}ms
                        </span>
                      </div>
                    </div>
                  </div>
                );
              }
              return null;
            }}
            cursor={{
              stroke: "hsl(var(--muted-foreground))",
              strokeWidth: 1,
              strokeDasharray: "4 4",
              opacity: 0.5,
            }}
          />
          {avgRtt > 0 && (
            <ReferenceLine
              y={avgRtt}
              stroke="hsl(var(--muted-foreground))"
              strokeDasharray="3 3"
              strokeOpacity={0.5}
            />
          )}
          <Area
            type="monotone"
            dataKey="rtt"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            fill="url(#rttGradient)"
            animationDuration={500}
            isAnimationActive={true}
          />
          <Line
            type="monotone"
            dataKey="rtt"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{
              r: 3,
              fill: "hsl(var(--background))",
              stroke: "hsl(var(--primary))",
              strokeWidth: 2,
            }}
            activeDot={{
              r: 5,
              strokeWidth: 2,
              fill: "hsl(var(--background))",
              stroke: "hsl(var(--primary))",
            }}
            isAnimationActive={true}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
