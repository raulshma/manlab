/**
 * Interactive Cron Expression Editor
 * Provides a high-fidelity UI for editing cron expressions with visual feedback
 */

import { useState, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Clock, Calendar, AlertCircle, CheckCircle2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface CronExpressionEditorProps {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

interface CronPreset {
  label: string;
  value: string;
  description: string;
  icon?: React.ReactNode;
}

const CRON_PRESETS: CronPreset[] = [
  {
    label: "Every 5 minutes",
    value: "0 */5 * * * ?",
    description: "Runs every 5 minutes",
    icon: <Clock className="h-3 w-3" />,
  },
  {
    label: "Every 15 minutes",
    value: "0 */15 * * * ?",
    description: "Runs every 15 minutes",
    icon: <Clock className="h-3 w-3" />,
  },
  {
    label: "Every 30 minutes",
    value: "0 */30 * * * ?",
    description: "Runs every 30 minutes",
    icon: <Clock className="h-3 w-3" />,
  },
  {
    label: "Every hour",
    value: "0 0 * * * ?",
    description: "Runs at the start of every hour",
    icon: <Clock className="h-3 w-3" />,
  },
  {
    label: "Every 6 hours",
    value: "0 0 */6 * * ?",
    description: "Runs every 6 hours",
    icon: <Clock className="h-3 w-3" />,
  },
  {
    label: "Every 12 hours",
    value: "0 0 */12 * * ?",
    description: "Runs every 12 hours",
    icon: <Clock className="h-3 w-3" />,
  },
  {
    label: "Daily at midnight",
    value: "0 0 0 * * ?",
    description: "Runs once per day at 00:00 UTC",
    icon: <Calendar className="h-3 w-3" />,
  },
  {
    label: "Daily at 2 AM",
    value: "0 0 2 * * ?",
    description: "Runs once per day at 02:00 UTC",
    icon: <Calendar className="h-3 w-3" />,
  },
  {
    label: "Weekly (Sunday)",
    value: "0 0 0 ? * SUN",
    description: "Runs every Sunday at midnight",
    icon: <Calendar className="h-3 w-3" />,
  },
];

function parseCronExpression(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 6 && parts.length !== 7) {
    return "Invalid cron expression format";
  }

  const [second, minute, hour, dayOfMonth, month, dayOfWeek] = parts;

  const descriptions: string[] = [];

  // Seconds
  if (second === "*") {
    descriptions.push("every second");
  } else if (second.startsWith("*/")) {
    const interval = second.substring(2);
    descriptions.push(`every ${interval} seconds`);
  } else if (second === "0") {
    // Skip if 0, it's the default
  } else {
    descriptions.push(`at second ${second}`);
  }

  // Minutes
  if (minute === "*") {
    descriptions.push("every minute");
  } else if (minute.startsWith("*/")) {
    const interval = minute.substring(2);
    descriptions.push(`every ${interval} minutes`);
  } else if (minute !== "0" && minute !== "*") {
    descriptions.push(`at minute ${minute}`);
  }

  // Hours
  if (hour === "*") {
    descriptions.push("every hour");
  } else if (hour.startsWith("*/")) {
    const interval = hour.substring(2);
    descriptions.push(`every ${interval} hours`);
  } else if (hour !== "*") {
    descriptions.push(`at ${hour}:00`);
  }

  // Day of month
  if (dayOfMonth !== "*" && dayOfMonth !== "?") {
    descriptions.push(`on day ${dayOfMonth}`);
  }

  // Month
  if (month !== "*") {
    descriptions.push(`in month ${month}`);
  }

  // Day of week
  if (dayOfWeek !== "*" && dayOfWeek !== "?") {
    const dayNames: Record<string, string> = {
      SUN: "Sunday",
      MON: "Monday",
      TUE: "Tuesday",
      WED: "Wednesday",
      THU: "Thursday",
      FRI: "Friday",
      SAT: "Saturday",
      "0": "Sunday",
      "1": "Monday",
      "2": "Tuesday",
      "3": "Wednesday",
      "4": "Thursday",
      "5": "Friday",
      "6": "Saturday",
    };
    descriptions.push(`on ${dayNames[dayOfWeek] || dayOfWeek}`);
  }

  if (descriptions.length === 0) {
    return "Runs continuously";
  }

  return "Runs " + descriptions.join(", ");
}

function validateCronExpression(cron: string): { valid: boolean; error?: string } {
  const trimmed = cron.trim();
  if (!trimmed) {
    return { valid: false, error: "Cron expression cannot be empty" };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 6 && parts.length !== 7) {
    return {
      valid: false,
      error: `Expected 6 or 7 fields, got ${parts.length}`,
    };
  }

  // Basic validation for each field
  const validPatterns = [
    /^(\*|[0-5]?\d|\*\/\d+|[0-5]?\d-[0-5]?\d)$/, // second
    /^(\*|[0-5]?\d|\*\/\d+|[0-5]?\d-[0-5]?\d)$/, // minute
    /^(\*|[01]?\d|2[0-3]|\*\/\d+|[01]?\d-2[0-3])$/, // hour
    /^(\*|\?|[1-9]|[12]\d|3[01]|\*\/\d+|L|W)$/, // day of month
    /^(\*|[1-9]|1[0-2]|\*\/\d+|JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)$/i, // month
    /^(\*|\?|[0-6]|\*\/\d+|SUN|MON|TUE|WED|THU|FRI|SAT|L|#)$/i, // day of week
  ];

  for (let i = 0; i < Math.min(parts.length, 6); i++) {
    if (!validPatterns[i].test(parts[i])) {
      return {
        valid: false,
        error: `Invalid value in field ${i + 1}: "${parts[i]}"`,
      };
    }
  }

  return { valid: true };
}

export function CronExpressionEditor({
  value,
  onChange,
  disabled = false,
}: CronExpressionEditorProps) {
  const [mode, setMode] = useState<"preset" | "custom">("preset");
  const [customValue, setCustomValue] = useState(value);
  const [selectedPreset, setSelectedPreset] = useState<string>("");

  useEffect(() => {
    // Check if current value matches a preset
    const matchingPreset = CRON_PRESETS.find((p) => p.value === value);
    if (matchingPreset) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedPreset(matchingPreset.value);
      setMode("preset");
    } else {
      setMode("custom");
      setCustomValue(value);
    }
  }, [value]);

  const validation = validateCronExpression(value);
  const description = validation.valid ? parseCronExpression(value) : "";

  const handlePresetChange = (presetValue: string) => {
    setSelectedPreset(presetValue);
    onChange(presetValue);
  };

  const handleCustomChange = (newValue: string) => {
    setCustomValue(newValue);
    onChange(newValue);
  };

  const applyPreset = (preset: CronPreset) => {
    setMode("preset");
    setSelectedPreset(preset.value);
    onChange(preset.value);
  };

  return (
    <div className="space-y-4">
      {/* Mode Toggle */}
      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant={mode === "preset" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("preset")}
          disabled={disabled}
          className="flex-1"
        >
          <Sparkles className="h-3 w-3 mr-1" />
          Presets
        </Button>
        <Button
          type="button"
          variant={mode === "custom" ? "default" : "outline"}
          size="sm"
          onClick={() => setMode("custom")}
          disabled={disabled}
          className="flex-1"
        >
          Custom
        </Button>
      </div>

      {/* Preset Mode */}
      {mode === "preset" && (
        <div className="space-y-3">
          <Label>Choose a schedule preset</Label>
          <Select
            value={selectedPreset}
            onValueChange={(value) => value && handlePresetChange(value)}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder="Select a preset schedule" />
            </SelectTrigger>
            <SelectContent>
              {CRON_PRESETS.map((preset) => (
                <SelectItem key={preset.value} value={preset.value}>
                  <div className="flex items-center gap-2">
                    {preset.icon}
                    <span>{preset.label}</span>
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>

          {/* Quick Preset Buttons */}
          <div className="grid grid-cols-2 gap-2">
            {CRON_PRESETS.slice(0, 6).map((preset) => (
              <Button
                key={preset.value}
                type="button"
                variant={selectedPreset === preset.value ? "default" : "outline"}
                size="sm"
                onClick={() => applyPreset(preset)}
                disabled={disabled}
                className="justify-start text-xs h-auto py-2"
              >
                <div className="flex flex-col items-start gap-0.5">
                  <span className="font-medium">{preset.label}</span>
                  <span className="text-[10px] opacity-70">{preset.value}</span>
                </div>
              </Button>
            ))}
          </div>
        </div>
      )}

      {/* Custom Mode */}
      {mode === "custom" && (
        <div className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="cron-custom">Cron Expression</Label>
            <Input
              id="cron-custom"
              value={customValue}
              onChange={(e) => handleCustomChange(e.target.value)}
              disabled={disabled}
              placeholder="0 */15 * * * ?"
              className={cn(
                "font-mono text-sm",
                !validation.valid && "border-destructive focus-visible:ring-destructive"
              )}
            />
          </div>

          {/* Field Guide */}
          <div className="text-xs text-muted-foreground space-y-1 p-3 bg-muted/50 rounded-md">
            <p className="font-medium mb-2">Cron Format (6 fields):</p>
            <div className="grid grid-cols-6 gap-1 font-mono">
              <div className="text-center">
                <div className="font-semibold">Sec</div>
                <div className="text-[10px]">0-59</div>
              </div>
              <div className="text-center">
                <div className="font-semibold">Min</div>
                <div className="text-[10px]">0-59</div>
              </div>
              <div className="text-center">
                <div className="font-semibold">Hour</div>
                <div className="text-[10px]">0-23</div>
              </div>
              <div className="text-center">
                <div className="font-semibold">Day</div>
                <div className="text-[10px]">1-31</div>
              </div>
              <div className="text-center">
                <div className="font-semibold">Mon</div>
                <div className="text-[10px]">1-12</div>
              </div>
              <div className="text-center">
                <div className="font-semibold">DoW</div>
                <div className="text-[10px]">0-6</div>
              </div>
            </div>
            <p className="pt-2">
              Special: <code className="px-1 py-0.5 bg-background rounded">*</code> (any),{" "}
              <code className="px-1 py-0.5 bg-background rounded">*/n</code> (every n),{" "}
              <code className="px-1 py-0.5 bg-background rounded">?</code> (no specific value)
            </p>
          </div>
        </div>
      )}

      {/* Validation & Description */}
      <div className="space-y-2">
        {validation.valid ? (
          <div className="flex items-start gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-md">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-green-900 dark:text-green-100">
                Valid expression
              </p>
              <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                {description}
              </p>
            </div>
          </div>
        ) : (
          <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
            <AlertCircle className="h-4 w-4 text-destructive mt-0.5 flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-destructive">Invalid expression</p>
              <p className="text-xs text-destructive/80 mt-1">{validation.error}</p>
            </div>
          </div>
        )}

        {/* Current Expression Badge */}
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-xs">
            {value}
          </Badge>
        </div>
      </div>
    </div>
  );
}
