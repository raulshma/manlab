import { memo } from "react";
import { Cloud, Droplets, Sun, Wind } from "lucide-react";
import type { WidgetProps } from "@/types/dashboard";

export const WeatherWidget = memo(function WeatherWidget({ config }: WidgetProps) {
  const location = (config.location as string) || "";
  const units = (config.units as string) || "celsius";

  const mockCondition = "Partly Cloudy";
  const mockTemp = units === "fahrenheit" ? "72°F" : "22°C";
  const mockHumidity = "65%";
  const mockWind = "8 mph";

  const conditionLower = mockCondition.toLowerCase();
  const isCloudy = conditionLower.includes("cloud") || conditionLower.includes("overcast");
  const isRainy = conditionLower.includes("rain") || conditionLower.includes("shower");
  const isClear = conditionLower.includes("clear") || conditionLower.includes("sunny");

  return (
    <div className="space-y-3">
      <div className="flex flex-col items-center justify-center p-6 text-center">
        <div className="mb-4">
          {isCloudy && <Cloud className="h-16 w-16 text-primary mx-auto" />}
          {isRainy && <Droplets className="h-16 w-16 text-primary mx-auto" />}
          {isClear && <Sun className="h-16 w-16 text-primary mx-auto" />}
          {!isCloudy && !isRainy && !isClear && <Wind className="h-16 w-16 text-primary mx-auto" />}
        </div>
        <div className="space-y-2">
          <h3 className="text-lg font-semibold">{location}</h3>
          <div className="text-5xl font-bold tabular-nums">
            {mockTemp}
          </div>
          <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground/70 mt-2">
            <div>
              <Droplets className="h-4 w-4 mx-auto" />
              <div className="mt-1">
                <div className="font-medium">Humidity</div>
                <div className="text-lg font-semibold">{mockHumidity}</div>
              </div>
            </div>
            <div>
              <Wind className="h-4 w-4 mx-auto" />
              <div className="mt-1">
                <div className="font-medium">Wind</div>
                <div className="text-lg font-semibold">{mockWind}</div>
              </div>
            </div>
            <div>
              <Sun className="h-4 w-4 mx-auto" />
              <div className="mt-1">
                <div className="font-medium">Condition</div>
                <div className="text-lg font-semibold">{mockCondition}</div>
              </div>
            </div>
          </div>
          <p className="text-xs text-muted-foreground/50 mt-4">
            Weather API integration needed for live data
          </p>
        </div>
      </div>
    </div>
  );
});
