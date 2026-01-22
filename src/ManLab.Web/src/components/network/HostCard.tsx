import {
  Copy,
  Globe,
  Radio,
  Route,
  Server,
  Terminal,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { notify } from "@/lib/network-notify";
import type { DiscoveredHost } from "@/api/networkApi";

interface HostCardProps {
  host: DiscoveredHost;
  onPing?: (ip: string) => void;
  onTraceroute?: (ip: string) => void;
  onPortScan?: (ip: string) => void;
}

function getRttBadgeVariant(
  rtt: number
): "default" | "secondary" | "outline" | "destructive" {
  if (rtt < 10) return "default";
  if (rtt < 50) return "secondary";
  if (rtt < 200) return "outline";
  return "destructive";
}

async function copyToClipboard(text: string): Promise<void> {
  await navigator.clipboard.writeText(text);
  notify.success("Copied to clipboard");
}

export function HostCard({ host, onPing, onTraceroute, onPortScan }: HostCardProps) {
  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            {/* IP Address */}
            <div className="flex items-center gap-2">
              <span className="font-mono text-lg font-semibold">
                {host.ipAddress}
              </span>
              <Tooltip>
                <TooltipTrigger
                  className={buttonVariants({ variant: "ghost", size: "sm" }) + " h-6 w-6 p-0"}
                  onClick={() => copyToClipboard(host.ipAddress)}
                  aria-label="Copy IP"
                >
                  <Copy className="h-3 w-3" />
                </TooltipTrigger>
                <TooltipContent>Copy IP</TooltipContent>
              </Tooltip>
            </div>

            {/* Hostname */}
            {host.hostname && (
              <div className="flex items-center gap-2 text-sm">
                <Globe className="h-4 w-4 text-muted-foreground" />
                <span className="truncate" title={host.hostname}>
                  {host.hostname}
                </span>
              </div>
            )}

            {/* MAC Address & Vendor */}
            {(host.macAddress || host.vendor) && (
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                {host.macAddress && (
                  <span className="font-mono">{host.macAddress}</span>
                )}
                {host.vendor && (
                  <Badge variant="outline" className="text-xs">
                    {host.vendor}
                  </Badge>
                )}
              </div>
            )}
          </div>

          {/* RTT Badge */}
          <div className="flex flex-col items-end gap-2">
            <Badge variant={getRttBadgeVariant(host.roundtripTime)}>
              {host.roundtripTime}ms
            </Badge>
            {host.ttl && (
              <span className="text-xs text-muted-foreground">
                TTL: {host.ttl}
              </span>
            )}
          </div>
        </div>

        {/* Quick Actions */}
        <div className="flex gap-1 mt-3 pt-3 border-t">
          <Tooltip>
            <TooltipTrigger
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              onClick={() => onPing?.(host.ipAddress)}
              aria-label="Ping host"
            >
              <Radio className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>Ping</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              onClick={() => onTraceroute?.(host.ipAddress)}
              aria-label="Traceroute host"
            >
              <Route className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>Traceroute</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              onClick={() => onPortScan?.(host.ipAddress)}
              aria-label="Port scan host"
            >
              <Server className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>Port Scan</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              className={buttonVariants({ variant: "ghost", size: "sm" })}
              onClick={() => window.open(`ssh://${host.ipAddress}`, "_blank")}
              aria-label="SSH to host"
            >
              <Terminal className="h-4 w-4" />
            </TooltipTrigger>
            <TooltipContent>SSH</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}