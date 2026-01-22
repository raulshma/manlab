import {
  Copy,
  Lock,
  Star,
  Unlock,
  Wifi,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { WifiNetwork } from "@/api/networkApi";
import { SignalStrengthIndicator } from "@/components/network/StatusIndicators";
import { isOpenNetwork, normalizeBand, copyToClipboard } from "./network-utils";

interface WifiNetworkCardProps {
  network: WifiNetwork;
}

export function WifiNetworkCard({ network }: WifiNetworkCardProps) {
  const band = normalizeBand(network.band);
  const isOpen = isOpenNetwork(network.securityType);

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-2 min-w-0">
            <div className="flex items-center gap-2">
              <Wifi className="h-4 w-4 text-primary" />
              <h4 className="font-medium truncate">
                {network.ssid || "Hidden Network"}
              </h4>
              {network.isHidden && (
                <Badge variant="outline" className="text-xs">
                  Hidden
                </Badge>
              )}
              {network.isConnected && (
                <Badge className="text-xs">
                  <Star className="h-3 w-3 mr-1" />
                  Connected
                </Badge>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono">BSSID: {network.bssid}</span>
              <Badge variant="secondary" className="text-xs capitalize">
                {band === "unknown" ? network.band : `${band} GHz`}
              </Badge>
              <Badge variant="outline" className="text-xs">
                Ch {network.channel}
              </Badge>
              <Badge variant="outline" className="text-xs">
                {network.frequency} MHz
              </Badge>
            </div>

            <div className="flex items-center gap-2">
              {isOpen ? (
                <Badge variant="destructive" className="text-xs">
                  <Unlock className="h-3 w-3 mr-1" />
                  Open
                </Badge>
              ) : (
                <Badge variant="outline" className="text-xs">
                  <Lock className="h-3 w-3 mr-1" />
                  {network.securityType || "Secured"}
                </Badge>
              )}
              {!isOpen && network.securityType?.toUpperCase().includes("WPA3") && (
                <Badge variant="secondary" className="text-xs">WPA3</Badge>
              )}
              {!isOpen && network.securityType?.toUpperCase().includes("WPA2") && (
                <Badge variant="secondary" className="text-xs">WPA2</Badge>
              )}
              {!isOpen && network.securityType?.toUpperCase().includes("WPA") && (
                <Badge variant="secondary" className="text-xs">WPA</Badge>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2">
            <SignalStrengthIndicator
              strength={network.signalStrength}
              showLabel
              showValue
              className="justify-end"
            />
            <div className="text-xs text-muted-foreground">
              {network.signalStrengthDbm ?? "—"} dBm
            </div>
          </div>
        </div>

        <div className="flex gap-2 mt-3 pt-3 border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  copyToClipboard(
                    `${network.ssid || "Hidden"} | ${network.bssid} | ${network.securityType}`
                  )
                }
                aria-label="Copy WiFi info"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy WiFi Info</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}