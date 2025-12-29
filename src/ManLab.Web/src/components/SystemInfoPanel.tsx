/**
 * SystemInfoPanel component displays detailed system information.
 * Shows General Info, CPU, RAM, Filesystem, and Network details in an accordion layout.
 */

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import {
  Cpu,
  MemoryStick,
  HardDrive,
  Network,
  Info,
  Thermometer,
} from "lucide-react";
import type { Node, Telemetry, NetworkTelemetryPoint, PingTelemetryPoint } from "../types";

interface SystemInfoPanelProps {
  node: Node;
  telemetry: Telemetry[];
  networkTelemetry: NetworkTelemetryPoint[];
  pingTelemetry: PingTelemetryPoint[];
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatUptime(lastSeen: string): string {
  const now = new Date();
  const lastSeenDate = new Date(lastSeen);
  const diffMs = now.getTime() - lastSeenDate.getTime();
  const diffSeconds = Math.floor(diffMs / 1000);
  
  if (diffSeconds < 60) return "Just now";
  if (diffSeconds < 3600) return `${Math.floor(diffSeconds / 60)}m ago`;
  if (diffSeconds < 86400) return `${Math.floor(diffSeconds / 3600)}h ago`;
  return `${Math.floor(diffSeconds / 86400)}d ago`;
}

export function SystemInfoPanel({
  node,
  telemetry,
  networkTelemetry,
  pingTelemetry,
}: SystemInfoPanelProps) {
  // Get the latest telemetry values
  const latestTelemetry = telemetry.length > 0 ? telemetry[telemetry.length - 1] : null;
  const latestNetwork = networkTelemetry.length > 0 ? networkTelemetry[networkTelemetry.length - 1] : null;
  const latestPing = pingTelemetry.length > 0 ? pingTelemetry[pingTelemetry.length - 1] : null;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-lg flex items-center gap-2">
          <Info className="h-5 w-5" />
          System Information
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <Accordion>
          {/* General Info */}
          <AccordionItem value="general">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Info className="h-4 w-4" />
                <span>General Info</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Hostname</span>
                  <p className="font-medium">{node.hostname}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p>
                    <Badge
                      variant={
                        node.status === "Online"
                          ? "default"
                          : node.status === "Offline"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {node.status}
                    </Badge>
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">IP Address</span>
                  <p className="font-mono">{node.ipAddress || "N/A"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">MAC Address</span>
                  <p className="font-mono">{node.macAddress || "N/A"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Operating System</span>
                  <p className="truncate" title={node.os || "N/A"}>
                    {node.os || "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Agent Version</span>
                  <p>{node.agentVersion ? `v${node.agentVersion}` : "N/A"}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Last Seen</span>
                  <p>{formatUptime(node.lastSeen)}</p>
                </div>
                <div>
                  <span className="text-muted-foreground">Registered</span>
                  <p>{new Date(node.createdAt).toLocaleDateString()}</p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* CPU Info */}
          <AccordionItem value="cpu">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Cpu className="h-4 w-4" />
                <span>CPU</span>
                {latestTelemetry && (
                  <Badge variant="outline" className="ml-2">
                    {latestTelemetry.cpuUsage.toFixed(1)}%
                  </Badge>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Current Usage</span>
                  <p className="font-medium">
                    {latestTelemetry ? `${latestTelemetry.cpuUsage.toFixed(1)}%` : "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Thermometer className="h-3 w-3" />
                    Temperature
                  </span>
                  <p className="font-medium">
                    {latestTelemetry?.temperature
                      ? `${latestTelemetry.temperature.toFixed(1)}°C`
                      : "N/A"}
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* RAM Info */}
          <AccordionItem value="ram">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <MemoryStick className="h-4 w-4" />
                <span>RAM</span>
                {latestTelemetry && (
                  <Badge variant="outline" className="ml-2">
                    {latestTelemetry.ramUsage.toFixed(1)}%
                  </Badge>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Usage</span>
                  <p className="font-medium">
                    {latestTelemetry ? `${latestTelemetry.ramUsage.toFixed(1)}%` : "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p className="font-medium">
                    {latestTelemetry?.ramUsage !== undefined ? (
                      latestTelemetry.ramUsage > 90 ? (
                        <Badge variant="destructive">Critical</Badge>
                      ) : latestTelemetry.ramUsage > 70 ? (
                        <Badge variant="secondary">Warning</Badge>
                      ) : (
                        <Badge variant="default">Normal</Badge>
                      )
                    ) : (
                      "N/A"
                    )}
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Filesystem Info */}
          <AccordionItem value="filesystem">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <HardDrive className="h-4 w-4" />
                <span>Filesystem</span>
                {latestTelemetry && (
                  <Badge variant="outline" className="ml-2">
                    {latestTelemetry.diskUsage.toFixed(1)}%
                  </Badge>
                )}
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Primary Disk Usage</span>
                  <p className="font-medium">
                    {latestTelemetry ? `${latestTelemetry.diskUsage.toFixed(1)}%` : "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Status</span>
                  <p className="font-medium">
                    {latestTelemetry?.diskUsage !== undefined ? (
                      latestTelemetry.diskUsage > 90 ? (
                        <Badge variant="destructive">Critical</Badge>
                      ) : latestTelemetry.diskUsage > 80 ? (
                        <Badge variant="secondary">Warning</Badge>
                      ) : (
                        <Badge variant="default">Normal</Badge>
                      )
                    ) : (
                      "N/A"
                    )}
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Network Info */}
          <AccordionItem value="network">
            <AccordionTrigger>
              <div className="flex items-center gap-2">
                <Network className="h-4 w-4" />
                <span>Network</span>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="text-muted-foreground">Download (RX)</span>
                  <p className="font-medium">
                    {latestNetwork?.netRxBytesPerSec !== null
                      ? `${formatBytes(latestNetwork?.netRxBytesPerSec ?? 0)}/s`
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Upload (TX)</span>
                  <p className="font-medium">
                    {latestNetwork?.netTxBytesPerSec !== null
                      ? `${formatBytes(latestNetwork?.netTxBytesPerSec ?? 0)}/s`
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Ping Target</span>
                  <p className="font-mono text-xs">
                    {latestPing?.pingTarget || "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Ping RTT</span>
                  <p className="font-medium">
                    {latestPing?.pingRttMs !== null
                      ? `${latestPing?.pingRttMs?.toFixed(1) ?? "N/A"} ms`
                      : "N/A"}
                  </p>
                </div>
                <div>
                  <span className="text-muted-foreground">Packet Loss</span>
                  <p className="font-medium">
                    {latestPing?.pingPacketLossPercent !== null
                      ? `${latestPing?.pingPacketLossPercent?.toFixed(1) ?? "N/A"}%`
                      : "N/A"}
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
    </Card>
  );
}
