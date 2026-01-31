import { memo } from "react";
import { Clock, Calendar } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";

export const TimeDateWidget = memo(function TimeDateWidget({ config }: WidgetProps) {
  const showDate = (config.showDate as boolean) ?? true;
  const timeFormat = (config.timeFormat as string) ?? "24h";
  const timeZone = (config.timeZone as string) ?? "";

  const getTime = (): string => {
    const now = new Date();
    
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timeZone || undefined,
      hour12: timeFormat === "12h",
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    };

    return now.toLocaleTimeString(undefined, options);
  };

  const getDate = (): string => {
    const now = new Date();
    
    const options: Intl.DateTimeFormatOptions = {
      timeZone: timeZone || undefined,
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    };

    return now.toLocaleDateString(undefined, options);
  };

  const time = getTime();

  return (
    <div className="flex flex-col items-center justify-center p-6 space-y-2">
      <div className="flex items-center gap-3">
        <Clock className="h-16 w-16 text-primary" />
        <div className="space-y-1 text-center">
          <div className="text-5xl font-bold tabular-nums tracking-tight">
            {time}
          </div>
          {timeFormat === "12h" && (
            <div className="text-sm text-muted-foreground/70">
              {new Date().toLocaleTimeString(undefined, { hour12: true, hour: "2-digit", minute: "2-digit" })}
            </div>
          )}
          {showDate && (
            <div className="flex items-center justify-center gap-2 text-muted-foreground/70">
              <Calendar className="h-4 w-4" />
              <span className="text-sm font-medium">{getDate()}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});
