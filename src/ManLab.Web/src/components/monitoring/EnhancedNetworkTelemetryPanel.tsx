import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { RefreshCw, Signal } from "lucide-react";
import type { NetworkTelemetry, Node } from "@/types";
import { fetchEnhancedNetworkTelemetry, fetchNodes } from "@/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

function formatRate(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1024) return `${value.toFixed(0)} B/s`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB/s`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  if (value < 1024) return `${value.toFixed(0)} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 * 1024 * 1024) return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  return `${(value / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatMs(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)} ms`;
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  return `${value.toFixed(1)}%`;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function InterfaceStatusBadge({ status }: { status: string }) {
  const normalized = status?.toLowerCase() ?? "unknown";
  const color = normalized === "up" || normalized === "operational" ? "bg-emerald-500/10 text-emerald-500" :
    normalized === "down" ? "bg-rose-500/10 text-rose-500" : "bg-muted text-muted-foreground";

  return (
    <Badge className={cn("text-[10px] font-mono", color)}>{status ?? "Unknown"}</Badge>
  );
}

export function EnhancedNetworkTelemetryPanel() {
  const { data: nodes, isLoading: nodesLoading } = useQuery({
    queryKey: ["nodes"],
    queryFn: fetchNodes,
    staleTime: 10_000,
    refetchInterval: 30_000,
  });

  const [selectedNodeId, setSelectedNodeId] = useState<string>("");

  const effectiveNodeId = useMemo(() => {
    if (!nodes || nodes.length === 0) return "";
    if (selectedNodeId && nodes.some((n) => n.id === selectedNodeId)) return selectedNodeId;
    return nodes[0].id;
  }, [nodes, selectedNodeId]);

  const telemetryQuery = useQuery<NetworkTelemetry | null>({
    queryKey: ["enhancedNetworkTelemetry", effectiveNodeId],
    queryFn: () => fetchEnhancedNetworkTelemetry(effectiveNodeId),
    enabled: !!effectiveNodeId,
    refetchInterval: 15_000,
  });

  const nodeMap = useMemo(() => new Map((nodes ?? []).map((n) => [n.id, n])), [nodes]);
  const selectedNode = nodeMap.get(effectiveNodeId) ?? null;
  const telemetry = telemetryQuery.data ?? null;

  const interfaces = useMemo(() => {
    const items = telemetry?.interfaces ?? [];
    return [...items].sort((a, b) => a.name.localeCompare(b.name));
  }, [telemetry]);

  const latency = telemetry?.latencyMeasurements ?? [];
  const connections = telemetry?.connections;
  const devices = telemetry?.discoveredDevices ?? [];

  return (
    <div className="space-y-6">
      <Card className="p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold flex items-center gap-2">
              <Signal className="h-4 w-4 text-primary" />
              Enhanced Network Telemetry
            </h3>
            <p className="text-sm text-muted-foreground">Latest agent-side network snapshot.</p>
          </div>
          <div className="flex items-center gap-2">
            {nodesLoading ? (
              <div className="text-sm text-muted-foreground">Loading nodes…</div>
            ) : (
              <Select value={effectiveNodeId} onValueChange={(value) => setSelectedNodeId(value ?? "")}>
                <SelectTrigger className="w-64">
                  <SelectValue>
                    {selectedNode ? `${selectedNode.hostname} (${selectedNode.status})` : "Select a node…"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {(nodes ?? []).map((n: Node) => (
                    <SelectItem key={n.id} value={n.id}>
                      {n.hostname} ({n.status})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={() => telemetryQuery.refetch()}
              disabled={!effectiveNodeId || telemetryQuery.isFetching}
            >
              <RefreshCw className={cn("h-4 w-4", telemetryQuery.isFetching && "animate-spin")} />
              Refresh
            </Button>
          </div>
        </div>

        <div className="text-xs text-muted-foreground">
          Last discovery scan: {formatDate(telemetry?.lastDiscoveryScanUtc ?? null)}
        </div>

        {!effectiveNodeId && (
          <div className="text-sm text-muted-foreground">No nodes available.</div>
        )}

        {effectiveNodeId && telemetryQuery.isLoading && (
          <div className="text-sm text-muted-foreground">Loading telemetry…</div>
        )}

        {effectiveNodeId && !telemetryQuery.isLoading && !telemetry && (
          <div className="text-sm text-muted-foreground">No enhanced network telemetry available.</div>
        )}
      </Card>

      {telemetry && (
        <>
          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Interfaces</h3>
              <div className="text-xs text-muted-foreground">{interfaces.length} interface(s)</div>
            </div>
            <Separator />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>IPv4</TableHead>
                  <TableHead>Rx</TableHead>
                  <TableHead>Tx</TableHead>
                  <TableHead>Util</TableHead>
                  <TableHead>Errors</TableHead>
                  <TableHead>Total Rx</TableHead>
                  <TableHead>Total Tx</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {interfaces.map((iface) => (
                  <TableRow key={iface.name}>
                    <TableCell className="font-medium">
                      <div className="flex flex-col">
                        <span>{iface.name}</span>
                        {iface.description && (
                          <span className="text-xs text-muted-foreground truncate max-w-55">{iface.description}</span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell><InterfaceStatusBadge status={iface.status} /></TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {(iface.iPv4Addresses ?? []).join(", ") || "—"}
                    </TableCell>
                    <TableCell>{formatRate(iface.rxBytesPerSec)}</TableCell>
                    <TableCell>{formatRate(iface.txBytesPerSec)}</TableCell>
                    <TableCell>{formatPercent(iface.utilizationPercent)}</TableCell>
                    <TableCell>{(iface.rxErrors ?? 0) + (iface.txErrors ?? 0)}</TableCell>
                    <TableCell>{formatBytes(iface.totalRxBytes)}</TableCell>
                    <TableCell>{formatBytes(iface.totalTxBytes)}</TableCell>
                  </TableRow>
                ))}
                {interfaces.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center text-sm text-muted-foreground">
                      No interfaces reported.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Latency Measurements</h3>
              <div className="text-xs text-muted-foreground">{latency.length} target(s)</div>
            </div>
            <Separator />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Target</TableHead>
                  <TableHead>RTT</TableHead>
                  <TableHead>Min</TableHead>
                  <TableHead>Max</TableHead>
                  <TableHead>Avg</TableHead>
                  <TableHead>Jitter</TableHead>
                  <TableHead>Loss</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {latency.map((entry) => (
                  <TableRow key={entry.target}>
                    <TableCell className="font-medium">{entry.target}</TableCell>
                    <TableCell>{formatMs(entry.rttMs)}</TableCell>
                    <TableCell>{formatMs(entry.minRttMs)}</TableCell>
                    <TableCell>{formatMs(entry.maxRttMs)}</TableCell>
                    <TableCell>{formatMs(entry.avgRttMs)}</TableCell>
                    <TableCell>{formatMs(entry.jitterMs)}</TableCell>
                    <TableCell>{formatPercent(entry.packetLossPercent)}</TableCell>
                  </TableRow>
                ))}
                {latency.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-sm text-muted-foreground">
                      No latency measurements yet.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Connection Summary</h3>
              <div className="text-xs text-muted-foreground">
                {connections ? "Active" : "No data"}
              </div>
            </div>
            <Separator />
            {connections ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
                  <div className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground">TCP Established</div>
                    <div className="text-lg font-semibold">{connections.tcpEstablished}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground">TCP TimeWait</div>
                    <div className="text-lg font-semibold">{connections.tcpTimeWait}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground">TCP CloseWait</div>
                    <div className="text-lg font-semibold">{connections.tcpCloseWait}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground">TCP Listening</div>
                    <div className="text-lg font-semibold">{connections.tcpListening}</div>
                  </div>
                  <div className="rounded-md border p-2">
                    <div className="text-xs text-muted-foreground">UDP Endpoints</div>
                    <div className="text-lg font-semibold">{connections.udpEndpoints}</div>
                  </div>
                </div>

                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Local</TableHead>
                      <TableHead>Remote</TableHead>
                      <TableHead>State</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(connections.topConnections ?? []).map((entry, index) => (
                      <TableRow key={`${entry.remoteEndpoint}-${index}`}>
                        <TableCell>{entry.localEndpoint}</TableCell>
                        <TableCell>{entry.remoteEndpoint}</TableCell>
                        <TableCell>{entry.state}</TableCell>
                      </TableRow>
                    ))}
                    {(connections.topConnections ?? []).length === 0 && (
                      <TableRow>
                        <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                          No active connections tracked.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground">No connection summary available.</div>
            )}
          </Card>

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold">Discovered Devices</h3>
              <div className="text-xs text-muted-foreground">{devices.length} device(s)</div>
            </div>
            <Separator />
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>IP</TableHead>
                  <TableHead>Hostname</TableHead>
                  <TableHead>MAC</TableHead>
                  <TableHead>Vendor</TableHead>
                  <TableHead>Reachable</TableHead>
                  <TableHead>RTT</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {devices.map((device) => (
                  <TableRow key={`${device.ipAddress}-${device.macAddress ?? ""}`}> 
                    <TableCell>{device.ipAddress}</TableCell>
                    <TableCell>{device.hostname ?? "—"}</TableCell>
                    <TableCell>{device.macAddress ?? "—"}</TableCell>
                    <TableCell>{device.vendor ?? "—"}</TableCell>
                    <TableCell>{device.isReachable ? "Yes" : "No"}</TableCell>
                    <TableCell>{formatMs(device.responseTimeMs)}</TableCell>
                  </TableRow>
                ))}
                {devices.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-sm text-muted-foreground">
                      No devices discovered.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
