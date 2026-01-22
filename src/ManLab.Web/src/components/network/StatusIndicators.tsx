import { useMemo } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress, ProgressLabel, ProgressValue } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/lib/download-utils";
import {
  getProgressAriaProps,
  getStatusAriaProps,
} from "@/lib/accessibility";

export type StatusKind =
  | "online"
  | "offline"
  | "success"
  | "failed"
  | "timeout"
  | "warning"
  | "info"
  | "pending";

interface StatusBadgeProps {
  status: StatusKind | string;
  label?: string;
  className?: string;
}

function normalizeStatus(status: string): StatusKind {
  const normalized = status.toLowerCase();
  if (normalized.includes("success") || normalized.includes("online")) return "success";
  if (normalized.includes("timeout")) return "timeout";
  if (normalized.includes("fail") || normalized.includes("error")) return "failed";
  if (normalized.includes("offline")) return "offline";
  if (normalized.includes("warn")) return "warning";
  if (normalized.includes("pending") || normalized.includes("queued")) return "pending";
  return "info";
}

export function StatusBadge({ status, label, className }: StatusBadgeProps) {
  const normalized = normalizeStatus(status);
  const variant =
    normalized === "success"
      ? "default"
      : normalized === "failed" || normalized === "timeout" || normalized === "offline"
      ? "destructive"
      : normalized === "warning"
      ? "secondary"
      : normalized === "pending"
      ? "outline"
      : "outline";

  const displayLabel = label ?? status;
  
  // Map status to accessibility type
  const statusType = useMemo(() => {
    if (normalized === "success" || normalized === "online") return "success" as const;
    if (normalized === "failed" || normalized === "timeout" || normalized === "offline") return "error" as const;
    if (normalized === "warning") return "warning" as const;
    return "info" as const;
  }, [normalized]);
  
  const ariaProps = getStatusAriaProps(displayLabel, statusType);

  return (
    <Badge 
      variant={variant} 
      className={cn(
        className,
        // Add WCAG AA compliant text colors
        statusType === "error" && "text-red-700 dark:text-red-300",
        statusType === "success" && "text-green-700 dark:text-green-300",
        statusType === "warning" && "text-amber-700 dark:text-amber-300"
      )}
      {...ariaProps}
    >
      {displayLabel}
    </Badge>
  );
}

interface LoadingSpinnerProps {
  label?: string;
  className?: string;
}

export function LoadingSpinner({ label, className }: LoadingSpinnerProps) {
  return (
    <div 
      className={cn("inline-flex items-center gap-2 text-sm", className)}
      role="status"
      aria-live="polite"
      aria-label={label || "Loading"}
    >
      <Spinner className="h-4 w-4" aria-hidden="true" />
      {label && <span className="text-muted-foreground">{label}</span>}
    </div>
  );
}

interface ProgressWithEtaProps {
  value: number;
  scanned?: number;
  total?: number;
  etaSeconds?: number | null;
  className?: string;
}

export function ProgressWithEta({
  value,
  scanned,
  total,
  etaSeconds,
  className,
}: ProgressWithEtaProps) {
  const etaLabel = useMemo(() => {
    if (etaSeconds === null || etaSeconds === undefined) return null;
    return `ETA ${formatDuration(etaSeconds)}`;
  }, [etaSeconds]);

  const progressLabel = useMemo(() => {
    if (typeof scanned === "number" && typeof total === "number") {
      return `Progress: ${value.toFixed(1)}%, ${scanned} of ${total} items checked${etaLabel ? `, ${etaLabel}` : ""}`;
    }
    return `Progress: ${value.toFixed(1)}%${etaLabel ? `, ${etaLabel}` : ""}`;
  }, [value, scanned, total, etaLabel]);

  const ariaProps = getProgressAriaProps(value, progressLabel);

  return (
    <div className={cn("space-y-2", className)}>
      <div {...ariaProps}>
        <Progress value={value}>
          <ProgressLabel>Progress</ProgressLabel>
          <ProgressValue>
            {(formattedValue, rawValue) =>
              formattedValue ?? `${(rawValue ?? value).toFixed(1)}%`
            }
          </ProgressValue>
        </Progress>
      </div>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span aria-hidden="true">
          {typeof scanned === "number" && typeof total === "number"
            ? `${scanned} / ${total} checked`
            : ""}
        </span>
        <span aria-hidden="true">{etaLabel ?? ""}</span>
      </div>
      {/* Screen reader only full status */}
      <div className="sr-only" aria-live="polite">
        {progressLabel}
      </div>
    </div>
  );
}

interface SignalStrengthIndicatorProps {
  strength: number;
  maxBars?: number;
  showLabel?: boolean;
  showValue?: boolean;
  className?: string;
}

function getSignalBars(strength: number, maxBars: number): number {
  if (strength >= 80) return maxBars;
  if (strength >= 60) return Math.max(1, maxBars - 1);
  if (strength >= 40) return Math.max(1, maxBars - 2);
  if (strength > 0) return 1;
  return 0;
}

function getSignalLabel(strength: number): string {
  if (strength >= 80) return "Excellent";
  if (strength >= 60) return "Good";
  if (strength >= 40) return "Fair";
  return "Weak";
}

export function SignalStrengthIndicator({
  strength,
  maxBars = 4,
  showLabel = true,
  showValue = true,
  className,
}: SignalStrengthIndicatorProps) {
  const bars = getSignalBars(strength, maxBars);
  const signalLabel = getSignalLabel(strength);
  
  // Determine color based on signal strength for WCAG AA compliance
  const signalColorClass = useMemo(() => {
    if (strength >= 80) return "text-green-600 dark:text-green-400";
    if (strength >= 60) return "text-lime-600 dark:text-lime-400";
    if (strength >= 40) return "text-amber-600 dark:text-amber-400";
    return "text-red-600 dark:text-red-400";
  }, [strength]);

  return (
    <div 
      className={cn("flex items-center gap-3", className)}
      role="img"
      aria-label={`Signal strength: ${signalLabel} (${strength}%)`}
    >
      <div className="flex items-end gap-1" aria-hidden="true">
        {Array.from({ length: maxBars }, (_, i) => (
          <div
            key={i}
            className={cn(
              "w-1.5 rounded-sm",
              i < bars ? "bg-primary" : "bg-muted"
            )}
            style={{ height: 6 + (i + 1) * 4 }}
          />
        ))}
      </div>
      {showValue && (
        <span className={cn("text-sm font-semibold tabular-nums", signalColorClass)}>
          {strength}%
        </span>
      )}
      {showLabel && (
        <Badge variant="outline" className={cn("text-xs", signalColorClass)}>
          {signalLabel}
        </Badge>
      )}
    </div>
  );
}
