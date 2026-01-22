import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Globe,
  Link,
  Router,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { MdnsService, UpnpDevice } from "@/api/networkApi";
import { copyToClipboard } from "./network-utils";
import {
  DEVICE_TYPE_ICONS,
  getMdnsDeviceType,
  getUpnpDeviceType,
} from "./device-constants";

interface MdnsServiceCardProps {
  service: MdnsService;
}

export function MdnsServiceCard({ service }: MdnsServiceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const serviceName = service.serviceName ?? service.name ?? "Unknown service";
  const hostname = service.hostname ?? "Unknown host";
  const serviceType = service.serviceType ?? "unknown";
  const ipAddresses = service.ipAddresses ?? [];
  const txtRecords = service.txtRecords ?? {};
  const deviceType = getMdnsDeviceType(serviceType);
  const DeviceIcon = DEVICE_TYPE_ICONS[deviceType];
  const hasTxtRecords = Object.keys(txtRecords).length > 0;

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
            <DeviceIcon className="h-5 w-5 text-blue-500" />
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-medium truncate" title={serviceName}>
                  {serviceName}
                </h4>
                <p className="text-xs text-muted-foreground font-mono truncate" title={serviceType}>
                  {serviceType}
                </p>
              </div>
              <div className="flex gap-1 shrink-0">
                <Badge variant="secondary" className="text-xs">mDNS</Badge>
                <Badge variant="outline" className="text-xs capitalize">
                  {deviceType}
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-4 text-sm">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Globe className="h-3.5 w-3.5" />
                <span className="truncate" title={hostname}>
                  {hostname}
                </span>
              </div>
              <Badge variant="outline" className="text-xs font-mono">
                Port: {service.port ?? 0}
              </Badge>
            </div>

            <div className="flex flex-wrap gap-1">
              {ipAddresses.map((ip, idx) => (
                <Tooltip key={idx}>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="secondary"
                      className="text-xs font-mono cursor-pointer hover:bg-secondary/80"
                      onClick={() => copyToClipboard(ip)}
                    >
                      {ip}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>Click to copy</TooltipContent>
                </Tooltip>
              ))}
            </div>

            {service.networkInterface && (
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Router className="h-3 w-3" />
                <span>Interface: {service.networkInterface}</span>
              </div>
            )}

            {hasTxtRecords && (
              <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger
                  className="inline-flex h-7 px-2 text-xs gap-1 items-center justify-center rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  TXT Records ({Object.keys(txtRecords).length})
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="rounded-md border bg-muted/50 p-2 text-xs font-mono space-y-1">
                    {Object.entries(txtRecords).map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-muted-foreground">{key}:</span>
                        <span className="break-all">{value || "(empty)"}</span>
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>

        <div className="flex gap-1 mt-3 pt-3 border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(serviceName)}
                aria-label="Copy service name"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy Name</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(ipAddresses.join(", "))}
                aria-label="Copy service IPs"
              >
                <Link className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy IPs</TooltipContent>
          </Tooltip>
        </div>
      </CardContent>
    </Card>
  );
}

interface UpnpDeviceCardProps {
  device: UpnpDevice;
}

export function UpnpDeviceCard({ device }: UpnpDeviceCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const deviceType = getUpnpDeviceType(device.deviceType ?? device.notificationType ?? null);
  const DeviceIcon = DEVICE_TYPE_ICONS[deviceType];
  const services = device.services ?? [];
  const location = device.location ?? device.descriptionLocation ?? null;
  const hasServices = services.length > 0;

  return (
    <Card className="hover:border-primary/50 transition-colors">
      <CardContent className="p-4">
        <div className="flex items-start gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
            <DeviceIcon className="h-5 w-5 text-green-500" />
          </div>

          <div className="flex-1 min-w-0 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <h4 className="font-medium truncate" title={device.friendlyName || "Unknown Device"}>
                  {device.friendlyName || "Unknown Device"}
                </h4>
                {(device.deviceType ?? device.notificationType) && (
                  <p
                    className="text-xs text-muted-foreground truncate"
                    title={device.deviceType ?? device.notificationType ?? ""}
                  >
                    {(device.deviceType ?? device.notificationType)?.split(":").pop()}
                  </p>
                )}
              </div>
              <div className="flex gap-1 shrink-0">
                <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600">
                  UPnP
                </Badge>
                <Badge variant="outline" className="text-xs capitalize">
                  {deviceType}
                </Badge>
              </div>
            </div>

            {(device.manufacturer || device.modelName) && (
              <div className="text-sm text-muted-foreground">
                {device.manufacturer && <span>{device.manufacturer}</span>}
                {device.manufacturer && device.modelName && <span> • </span>}
                {device.modelName && <span>{device.modelName}</span>}
                {device.modelNumber && <span className="text-xs"> ({device.modelNumber})</span>}
              </div>
            )}

            <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono truncate">
              <span title={device.usn}>
                {device.usn.length > 50 ? device.usn.slice(0, 50) + "..." : device.usn}
              </span>
            </div>

            {hasServices && (
              <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
                <CollapsibleTrigger
                  className="inline-flex h-7 px-2 text-xs gap-1 items-center justify-center rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                >
                  {isExpanded ? (
                    <ChevronUp className="h-3 w-3" />
                  ) : (
                    <ChevronDown className="h-3 w-3" />
                  )}
                  Services ({services.length})
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="rounded-md border bg-muted/50 p-2 text-xs font-mono space-y-1">
                    {services.map((service, idx) => (
                      <div key={idx} className="truncate" title={service}>
                        {service.split(":").pop()}
                      </div>
                    ))}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            )}
          </div>
        </div>

        <div className="flex gap-1 mt-3 pt-3 border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => copyToClipboard(device.friendlyName || device.usn)}
                aria-label="Copy device name"
              >
                <Copy className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Copy Name</TooltipContent>
          </Tooltip>
          {location && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => window.open(location, "_blank")}
                  aria-label="View device details"
                >
                  <ExternalLink className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>View Device XML</TooltipContent>
            </Tooltip>
          )}
        </div>
      </CardContent>
    </Card>
  );
}