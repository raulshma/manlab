/**
 * AggregatedDeviceCard Component
 * Displays a card for a device grouped by IP address,
 * showing summary info with a button to view all details in a modal.
 */

import { Copy, Layers, Server } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { copyToClipboard } from "./network-utils";
import {
  DEVICE_TYPE_ICONS,
  getMdnsDeviceType,
  getUpnpDeviceType,
} from "./device-constants";
import { DeviceDetailModal } from "./DeviceDetailModal";
import type { AggregatedDevice } from "./device-aggregation";

interface AggregatedDeviceCardProps {
  device: AggregatedDevice;
}

export function AggregatedDeviceCard({ device }: AggregatedDeviceCardProps) {
  const totalServices = device.mdnsServices.length + device.upnpDevices.length;
  
  // Determine the primary device type for the icon
  const primaryDeviceType = device.mdnsServices.length > 0
    ? getMdnsDeviceType(device.mdnsServices[0].serviceType ?? "")
    : device.upnpDevices.length > 0
    ? getUpnpDeviceType(device.upnpDevices[0].deviceType ?? device.upnpDevices[0].notificationType ?? null)
    : "other";
  
  const DeviceIcon = DEVICE_TYPE_ICONS[primaryDeviceType];

  // Determine protocol badge color
  const protocolBadgeClass =
    device.primaryProtocol === "both"
      ? "bg-purple-500/10 text-purple-600"
      : device.primaryProtocol === "upnp"
      ? "bg-green-500/10 text-green-600"
      : "text-blue-600";

  // Get unique service types for preview
  const serviceTypes = [
    ...new Set([
      ...device.mdnsServices.map((s) => s.serviceType ?? "unknown"),
      ...device.upnpDevices.map(
        (d) => (d.deviceType ?? d.notificationType ?? "unknown").split(":").pop() ?? "unknown"
      ),
    ]),
  ].slice(0, 3);

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
              device.primaryProtocol === "upnp"
                ? "bg-green-500/10"
                : device.primaryProtocol === "both"
                ? "bg-purple-500/10"
                : "bg-blue-500/10"
            }`}
          >
            <DeviceIcon
              className={`h-5 w-5 ${
                device.primaryProtocol === "upnp"
                  ? "text-green-500"
                  : device.primaryProtocol === "both"
                  ? "text-purple-500"
                  : "text-blue-500"
              }`}
            />
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-medium truncate" title={device.displayName}>
                  {device.displayName}
                </h4>
                <p className="text-xs text-muted-foreground font-mono" title={device.ipAddress}>
                  {device.ipAddress}
                </p>
              </div>
              <div className="flex gap-1 shrink-0 flex-wrap justify-end">
                <Badge variant="secondary" className={`text-xs ${protocolBadgeClass}`}>
                  {device.primaryProtocol === "both"
                    ? "mDNS+UPnP"
                    : device.primaryProtocol.toUpperCase()}
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">
                  {primaryDeviceType}
                </Badge>
              </div>
            </div>

            {/* Hostnames if available */}
            {device.hostnames.length > 0 && (
              <p className="text-xs text-muted-foreground truncate">
                {device.hostnames.join(", ")}
              </p>
            )}

            {/* Service count and quick preview */}
            <div className="flex flex-wrap items-center gap-1.5">
              <Badge variant="secondary" className="text-xs">
                <Layers className="h-3 w-3 mr-1" />
                {totalServices} service{totalServices !== 1 ? "s" : ""}
              </Badge>
              {device.ports.length > 0 && device.ports.length <= 3 && (
                <Badge variant="outline" className="text-xs font-mono">
                  Ports: {device.ports.join(", ")}
                </Badge>
              )}
              {device.ports.length > 3 && (
                <Badge variant="outline" className="text-xs font-mono">
                  {device.ports.length} ports
                </Badge>
              )}
            </div>

            {/* Service type preview */}
            {serviceTypes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {serviceTypes.map((type, idx) => (
                  <Badge key={idx} variant="outline" className="text-xs text-muted-foreground">
                    {type.replace(/^_/, "").replace(/\..*$/, "")}
                  </Badge>
                ))}
                {device.mdnsServices.length + device.upnpDevices.length > 3 && (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    +{device.mdnsServices.length + device.upnpDevices.length - 3} more
                  </Badge>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="flex gap-1 mt-3 pt-3 border-t justify-between">
          <div className="flex gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => copyToClipboard(device.ipAddress)}
                  aria-label="Copy IP address"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy IP</TooltipContent>
            </Tooltip>
          </div>
          
          {/* View All button that opens modal */}
          <DeviceDetailModal
            device={device}
            trigger={
              <Button variant="outline" size="sm">
                <Server className="h-4 w-4 mr-1" />
                View Details
              </Button>
            }
          />
        </div>
      </CardContent>
    </Card>
  );
}
