/**
 * DeviceDetailModal Component
 * Shows all discovered services/information for a device (grouped by IP address)
 */

import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  Globe,
  Link,
  Router,
  Server,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
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
import { Separator } from "@/components/ui/separator";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { MdnsService, UpnpDevice } from "@/api/networkApi";
import { copyToClipboard } from "./network-utils";
import {
  DEVICE_TYPE_ICONS,
  getMdnsDeviceType,
  getUpnpDeviceType,
} from "./device-constants";
import type { AggregatedDevice } from "./device-aggregation";

// ============================================================================
// Components
// ============================================================================

interface MdnsServiceDetailProps {
  service: MdnsService;
}

function MdnsServiceDetail({ service }: MdnsServiceDetailProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const serviceName = service.serviceName ?? service.name ?? "Unknown service";
  const serviceType = service.serviceType ?? "unknown";
  const txtRecords = service.txtRecords ?? {};
  const hasTxtRecords = Object.keys(txtRecords).length > 0;
  const deviceType = getMdnsDeviceType(serviceType);
  const DeviceIcon = DEVICE_TYPE_ICONS[deviceType];

  return (
    <div className="rounded-lg border bg-card/50 p-3 space-y-2">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-500/10">
          <DeviceIcon className="h-4 w-4 text-blue-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h5 className="font-medium text-sm truncate" title={serviceName}>
              {serviceName}
            </h5>
            <Badge variant="outline" className="text-xs capitalize">
              {deviceType}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground font-mono truncate" title={serviceType}>
            {serviceType}
          </p>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <Badge variant="secondary" className="text-xs font-mono">
              Port: {service.port ?? 0}
            </Badge>
            {service.hostname && (
              <span className="flex items-center gap-1">
                <Globe className="h-3 w-3" />
                {service.hostname}
              </span>
            )}
          </div>
        </div>
      </div>

      {hasTxtRecords && (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger className="inline-flex h-6 px-2 text-xs gap-1 items-center rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
            TXT Records ({Object.keys(txtRecords).length})
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-2">
            <div className="rounded-md border bg-muted/50 p-2 text-xs font-mono space-y-1">
              {Object.entries(txtRecords).map(([key, value]) => (
                <div key={key} className="flex gap-2">
                  <span className="text-muted-foreground shrink-0">{key}:</span>
                  <span className="break-all">{value || "(empty)"}</span>
                </div>
              ))}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

interface UpnpDeviceDetailProps {
  device: UpnpDevice;
}

function UpnpDeviceDetail({ device }: UpnpDeviceDetailProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const deviceType = getUpnpDeviceType(device.deviceType ?? device.notificationType ?? null);
  const DeviceIcon = DEVICE_TYPE_ICONS[deviceType];
  const services = device.services ?? [];
  const location = device.location ?? device.descriptionLocation ?? null;
  const hasServices = services.length > 0;

  return (
    <div className="rounded-lg border bg-card/50 p-3 space-y-2">
      <div className="flex items-start gap-3">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-green-500/10">
          <DeviceIcon className="h-4 w-4 text-green-500" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h5 className="font-medium text-sm truncate" title={device.friendlyName || "Unknown Device"}>
              {device.friendlyName || "Unknown Device"}
            </h5>
            <Badge variant="outline" className="text-xs capitalize">
              {deviceType}
            </Badge>
          </div>
          {(device.deviceType ?? device.notificationType) && (
            <p
              className="text-xs text-muted-foreground truncate"
              title={device.deviceType ?? device.notificationType ?? ""}
            >
              {(device.deviceType ?? device.notificationType)?.split(":").pop()}
            </p>
          )}
          {(device.manufacturer || device.modelName) && (
            <div className="text-xs text-muted-foreground mt-1">
              {device.manufacturer && <span>{device.manufacturer}</span>}
              {device.manufacturer && device.modelName && <span> • </span>}
              {device.modelName && <span>{device.modelName}</span>}
              {device.modelNumber && <span className="text-xs"> ({device.modelNumber})</span>}
            </div>
          )}
          <div className="flex items-center gap-1 mt-1 text-xs text-muted-foreground font-mono">
            <span className="truncate" title={device.usn}>
              USN: {device.usn.length > 40 ? device.usn.slice(0, 40) + "..." : device.usn}
            </span>
          </div>
        </div>
      </div>

      <div className="flex gap-1">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => copyToClipboard(device.usn)}
              aria-label="Copy USN"
            >
              <Copy className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Copy USN</TooltipContent>
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
                <ExternalLink className="h-3 w-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>View Device XML</TooltipContent>
          </Tooltip>
        )}
      </div>

      {hasServices && (
        <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
          <CollapsibleTrigger className="inline-flex h-6 px-2 text-xs gap-1 items-center rounded-md font-medium transition-colors hover:bg-accent hover:text-accent-foreground">
            {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
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
  );
}

// ============================================================================
// Main Modal Component
// ============================================================================

interface DeviceDetailModalProps {
  device: AggregatedDevice;
  trigger?: React.ReactNode;
}

export function DeviceDetailModal({ device, trigger }: DeviceDetailModalProps) {
  const totalServices = device.mdnsServices.length + device.upnpDevices.length;

  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm">
            <Layers className="h-4 w-4 mr-1" />
            View All ({totalServices})
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-2xl max-h-[85vh]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            {device.displayName}
          </DialogTitle>
          <DialogDescription>
            All discovered services and information for{" "}
            <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">
              {device.ipAddress}
            </code>
          </DialogDescription>
        </DialogHeader>

        <ScrollArea className="max-h-[60vh] pr-4">
          <div className="space-y-4">
            {/* Device Overview */}
            <div className="grid gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">IP Address:</span>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge
                      variant="secondary"
                      className="font-mono cursor-pointer hover:bg-secondary/80"
                      onClick={() => copyToClipboard(device.ipAddress)}
                    >
                      {device.ipAddress}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>Click to copy</TooltipContent>
                </Tooltip>
              </div>
              {device.hostnames.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0">Hostnames:</span>
                  <div className="flex flex-wrap gap-1">
                    {device.hostnames.map((hostname, idx) => (
                      <Badge key={idx} variant="outline" className="text-xs">
                        {hostname}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {device.ports.length > 0 && (
                <div className="flex items-start gap-2">
                  <span className="text-muted-foreground shrink-0">Ports:</span>
                  <div className="flex flex-wrap gap-1">
                    {device.ports.map((port) => (
                      <Badge key={port} variant="secondary" className="text-xs font-mono">
                        {port}
                      </Badge>
                    ))}
                  </div>
                </div>
              )}
              {device.networkInterfaces.length > 0 && (
                <div className="flex items-center gap-2">
                  <Router className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-muted-foreground">Interfaces:</span>
                  <span>{device.networkInterfaces.join(", ")}</span>
                </div>
              )}
            </div>

            {/* mDNS Services */}
            {device.mdnsServices.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs">mDNS</Badge>
                    Services ({device.mdnsServices.length})
                  </h4>
                  <div className="space-y-2">
                    {device.mdnsServices.map((service, idx) => (
                      <MdnsServiceDetail
                        key={`${service.serviceType ?? "unknown"}-${service.port ?? 0}-${idx}`}
                        service={service}
                      />
                    ))}
                  </div>
                </div>
              </>
            )}

            {/* UPnP Devices */}
            {device.upnpDevices.length > 0 && (
              <>
                <Separator />
                <div className="space-y-3">
                  <h4 className="text-sm font-medium flex items-center gap-2">
                    <Badge variant="secondary" className="text-xs bg-green-500/10 text-green-600">
                      UPnP
                    </Badge>
                    Devices ({device.upnpDevices.length})
                  </h4>
                  <div className="space-y-2">
                    {device.upnpDevices.map((upnpDevice) => (
                      <UpnpDeviceDetail key={upnpDevice.usn} device={upnpDevice} />
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>
        </ScrollArea>

        <div className="flex justify-between items-center pt-2 border-t">
          <div className="flex items-center gap-1">
            <Badge variant="outline" className="text-xs">
              {totalServices} service{totalServices !== 1 ? "s" : ""}
            </Badge>
            {device.primaryProtocol === "both" && (
              <Badge variant="secondary" className="text-xs">mDNS + UPnP</Badge>
            )}
          </div>
          <div className="flex gap-1">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyToClipboard(device.ipAddress)}
                >
                  <Link className="h-4 w-4 mr-1" />
                  Copy IP
                </Button>
              </TooltipTrigger>
              <TooltipContent>Copy IP address</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
