import { useMemo } from "react";
import { Network } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { DiscoveredHost } from "@/api/networkApi";

interface NetworkMapProps {
  hosts: DiscoveredHost[];
}

function getSubnetKey(ip: string): string {
  const parts = ip.split(".");
  return parts.length >= 3 ? `${parts[0]}.${parts[1]}.${parts[2]}.0/24` : ip;
}

export function NetworkMap({ hosts }: NetworkMapProps) {
  const groups = useMemo(() => {
    const map = new Map<string, DiscoveredHost[]>();
    hosts.forEach((host) => {
      const key = getSubnetKey(host.ipAddress);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(host);
    });
    return Array.from(map.entries()).map(([subnet, entries]) => ({
      subnet,
      hosts: entries.sort((a, b) => a.ipAddress.localeCompare(b.ipAddress)),
    }));
  }, [hosts]);

  if (hosts.length === 0) return null;

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Network className="h-4 w-4 text-primary" />
          Network Map
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {groups.map((group) => (
          <div key={group.subnet} className="space-y-2">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {group.subnet}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {group.hosts.length} host{group.hosts.length !== 1 ? "s" : ""}
              </span>
            </div>
            <div className="flex flex-wrap gap-2">
              {group.hosts.map((host) => (
                <Tooltip key={host.ipAddress}>
                  <TooltipTrigger>
                    <div className="h-8 w-8 rounded-full bg-primary/10 border border-primary/30 flex items-center justify-center text-xs font-mono">
                      {host.ipAddress.split(".").pop()}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <div className="text-xs">
                      <div>{host.ipAddress}</div>
                      {host.hostname && <div>{host.hostname}</div>}
                    </div>
                  </TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}