import type { LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

interface DashboardStatsCardProps {
  title: string;
  value: string;
  icon: LucideIcon;
  hint?: string;
  trend?: "up" | "down" | "neutral";
  trendLabel?: string;
  isLoading?: boolean;
  accentColor?: string;
}

/**
 * Premium stat card component for the dashboard.
 * Matches the high-fidelity design from AnalyticsPage.
 */
export function DashboardStatsCard({
  title,
  value,
  icon: Icon,
  hint,
  trend,
  trendLabel,
  isLoading = false,
  accentColor = "primary",
}: DashboardStatsCardProps) {
  if (isLoading) {
    return (
      <Card className="relative overflow-hidden border border-border shadow-sm bg-card">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-8 rounded-full" />
        </CardHeader>
        <CardContent>
          <Skeleton className="h-8 w-16 mb-2" />
          <Skeleton className="h-3 w-32" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="relative overflow-hidden border border-border shadow-sm bg-card transition-all duration-300 hover:shadow-lg hover:scale-[1.02] group">
      {/* Decorative gradient circle */}
      <div
        className={cn(
          "absolute top-0 right-0 -mt-6 -mr-6 h-28 w-28 rounded-full transition-all duration-300",
          accentColor === "primary" && "bg-primary/5 group-hover:bg-primary/10",
          accentColor === "emerald" && "bg-emerald-500/5 group-hover:bg-emerald-500/10",
          accentColor === "rose" && "bg-rose-500/5 group-hover:bg-rose-500/10",
          accentColor === "amber" && "bg-amber-500/5 group-hover:bg-amber-500/10"
        )}
      />
      
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {title}
        </CardTitle>
        <div
          className={cn(
            "p-2.5 rounded-full transition-colors",
            accentColor === "primary" && "bg-primary/10 text-primary",
            accentColor === "emerald" && "bg-emerald-500/10 text-emerald-500",
            accentColor === "rose" && "bg-rose-500/10 text-rose-500",
            accentColor === "amber" && "bg-amber-500/10 text-amber-500"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
      </CardHeader>
      
      <CardContent className="pt-0">
        <div className="flex items-baseline gap-2">
          <div className="text-3xl font-extrabold tracking-tight tabular-nums">
            {value}
          </div>
          {trend && trendLabel && (
            <span
              className={cn(
                "text-xs font-medium px-2 py-0.5 rounded-full",
                trend === "up" && "bg-emerald-500/10 text-emerald-500",
                trend === "down" && "bg-rose-500/10 text-rose-500",
                trend === "neutral" && "bg-zinc-500/10 text-zinc-500"
              )}
            >
              {trendLabel}
            </span>
          )}
        </div>
        {hint && (
          <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>
        )}
      </CardContent>
    </Card>
  );
}
