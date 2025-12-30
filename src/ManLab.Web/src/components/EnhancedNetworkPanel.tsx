/**
 * EnhancedNetworkPanel component for displaying detailed network telemetry.
 * Shows per-interface bandwidth, latency measurements, connections, and device discovery.
 */

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { 
  Network, 
  Activity, 
  Globe, 
  ArrowDownToLine, 
  ArrowUpFromLine,
  Router
} from 'lucide-react';
import type { NetworkTelemetry, NetworkInterfaceTelemetry, LatencyMeasurement, ConnectionsSummary, DiscoveredDevice } from '../types';

interface EnhancedNetworkPanelProps {
  data: NetworkTelemetry | null;
}

function formatBytes(bytes: number | null): string {
  if (bytes === null) return '--';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatBytesPerSec(bytesPerSec: number | null): string {
  if (bytesPerSec === null) return '--';
  if (bytesPerSec < 1024) return `${bytesPerSec.toFixed(0)} B/s`;
  if (bytesPerSec < 1024 * 1024) return `${(bytesPerSec / 1024).toFixed(1)} KB/s`;
  if (bytesPerSec < 1024 * 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  return `${(bytesPerSec / (1024 * 1024 * 1024)).toFixed(2)} GB/s`;
}

function formatSpeed(bps: number | null): string {
  if (bps === null) return '--';
  if (bps < 1000000) return `${(bps / 1000).toFixed(0)} Kbps`;
  if (bps < 1000000000) return `${(bps / 1000000).toFixed(0)} Mbps`;
  return `${(bps / 1000000000).toFixed(1)} Gbps`;
}

function InterfaceCard({ iface }: { iface: NetworkInterfaceTelemetry }) {
  const isUp = iface.status === 'Up';
  
  return (
    <div className="p-3 rounded-lg border bg-card space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Network className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium text-sm">{iface.name}</span>
        </div>
        <Badge variant={isUp ? "default" : "secondary"} className="text-xs">
          {iface.status}
        </Badge>
      </div>
      
      {iface.description && (
        <p className="text-xs text-muted-foreground truncate">{iface.description}</p>
      )}
      
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div>
          <span className="text-muted-foreground">Type:</span>
          <span className="ml-1">{iface.interfaceType || '--'}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Speed:</span>
          <span className="ml-1">{formatSpeed(iface.speedBps)}</span>
        </div>
        {iface.macAddress && (
          <div className="col-span-2">
            <span className="text-muted-foreground">MAC:</span>
            <span className="ml-1 font-mono text-[10px]">{iface.macAddress}</span>
          </div>
        )}
        {iface.iPv4Addresses && iface.iPv4Addresses.length > 0 && (
          <div className="col-span-2">
            <span className="text-muted-foreground">IPv4:</span>
            <span className="ml-1 font-mono">{iface.iPv4Addresses.join(', ')}</span>
          </div>
        )}
      </div>

      {isUp && (
        <div className="space-y-2 pt-2 border-t">
          <div className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1 text-green-600">
              <ArrowDownToLine className="w-3 h-3" />
              RX: {formatBytesPerSec(iface.rxBytesPerSec)}
            </span>
            <span className="flex items-center gap-1 text-blue-600">
              <ArrowUpFromLine className="w-3 h-3" />
              TX: {formatBytesPerSec(iface.txBytesPerSec)}
            </span>
          </div>
          
          {iface.utilizationPercent !== null && (
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Utilization</span>
                <span>{iface.utilizationPercent.toFixed(1)}%</span>
              </div>
              <Progress value={iface.utilizationPercent} className="h-1.5" />
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-[10px] text-muted-foreground">
            <div>Total RX: {formatBytes(iface.totalRxBytes)}</div>
            <div>Total TX: {formatBytes(iface.totalTxBytes)}</div>
            {(iface.rxErrors ?? 0) > 0 && (
              <div className="text-destructive">RX Errors: {iface.rxErrors}</div>
            )}
            {(iface.txErrors ?? 0) > 0 && (
              <div className="text-destructive">TX Errors: {iface.txErrors}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function LatencyCard({ measurement }: { measurement: LatencyMeasurement }) {
  const hasPacketLoss = (measurement.packetLossPercent ?? 0) > 0;
  
  return (
    <div className="p-3 rounded-lg border bg-card space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="w-4 h-4 text-muted-foreground" />
          <span className="font-mono text-sm">{measurement.target}</span>
        </div>
        {hasPacketLoss && (
          <Badge variant="destructive" className="text-xs">
            {measurement.packetLossPercent?.toFixed(1)}% loss
          </Badge>
        )}
      </div>
      
      <div className="grid grid-cols-4 gap-2 text-xs">
        <div className="text-center">
          <div className="text-muted-foreground">Current</div>
          <div className="font-medium">{measurement.rttMs?.toFixed(1) ?? '--'} ms</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Min</div>
          <div className="font-medium text-green-600">{measurement.minRttMs?.toFixed(1) ?? '--'} ms</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Avg</div>
          <div className="font-medium">{measurement.avgRttMs?.toFixed(1) ?? '--'} ms</div>
        </div>
        <div className="text-center">
          <div className="text-muted-foreground">Max</div>
          <div className="font-medium text-amber-600">{measurement.maxRttMs?.toFixed(1) ?? '--'} ms</div>
        </div>
      </div>
      
      {measurement.jitterMs !== null && (
        <div className="text-xs text-muted-foreground">
          Jitter: {measurement.jitterMs.toFixed(2)} ms
        </div>
      )}
    </div>
  );
}

function ConnectionsCard({ connections }: { connections: ConnectionsSummary }) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="p-3 rounded-lg border bg-card text-center">
          <div className="text-2xl font-bold text-green-600">{connections.tcpEstablished}</div>
          <div className="text-xs text-muted-foreground">Established</div>
        </div>
        <div className="p-3 rounded-lg border bg-card text-center">
          <div className="text-2xl font-bold text-blue-600">{connections.tcpListening}</div>
          <div className="text-xs text-muted-foreground">Listening</div>
        </div>
        <div className="p-3 rounded-lg border bg-card text-center">
          <div className="text-2xl font-bold text-amber-600">{connections.tcpTimeWait}</div>
          <div className="text-xs text-muted-foreground">TIME_WAIT</div>
        </div>
        <div className="p-3 rounded-lg border bg-card text-center">
          <div className="text-2xl font-bold text-orange-600">{connections.tcpCloseWait}</div>
          <div className="text-xs text-muted-foreground">CLOSE_WAIT</div>
        </div>
        <div className="p-3 rounded-lg border bg-card text-center">
          <div className="text-2xl font-bold text-purple-600">{connections.udpEndpoints}</div>
          <div className="text-xs text-muted-foreground">UDP</div>
        </div>
      </div>
      
      {connections.topConnections && connections.topConnections.length > 0 && (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">Local</th>
                <th className="px-3 py-2 text-left">Remote</th>
                <th className="px-3 py-2 text-left">State</th>
                <th className="px-3 py-2 text-left">Process</th>
              </tr>
            </thead>
            <tbody>
              {connections.topConnections.slice(0, 10).map((conn, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2 font-mono">{conn.localEndpoint}</td>
                  <td className="px-3 py-2 font-mono">{conn.remoteEndpoint}</td>
                  <td className="px-3 py-2">
                    <Badge variant="outline" className="text-[10px]">{conn.state}</Badge>
                  </td>
                  <td className="px-3 py-2">{conn.processName || conn.processId || '--'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DeviceDiscoveryCard({ devices, lastScan }: { devices: DiscoveredDevice[], lastScan: string | null }) {
  return (
    <div className="space-y-3">
      {lastScan && (
        <div className="text-xs text-muted-foreground">
          Last scan: {new Date(lastScan).toLocaleString()}
        </div>
      )}
      
      {devices.length === 0 ? (
        <div className="text-center py-8 text-muted-foreground">
          <Router className="w-8 h-8 mx-auto mb-2 opacity-50" />
          <p>No devices discovered</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left">IP Address</th>
                <th className="px-3 py-2 text-left">Hostname</th>
                <th className="px-3 py-2 text-left">MAC</th>
                <th className="px-3 py-2 text-left">Vendor</th>
                <th className="px-3 py-2 text-left">Response</th>
              </tr>
            </thead>
            <tbody>
              {devices.map((device, idx) => (
                <tr key={idx} className="border-t">
                  <td className="px-3 py-2 font-mono">{device.ipAddress}</td>
                  <td className="px-3 py-2">{device.hostname || '--'}</td>
                  <td className="px-3 py-2 font-mono text-[10px]">{device.macAddress || '--'}</td>
                  <td className="px-3 py-2">{device.vendor || '--'}</td>
                  <td className="px-3 py-2">
                    {device.isReachable ? (
                      <span className="text-green-600">{device.responseTimeMs?.toFixed(0)} ms</span>
                    ) : (
                      <span className="text-muted-foreground">--</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function EnhancedNetworkPanel({ data }: EnhancedNetworkPanelProps) {
  if (!data) {
    return null;
  }

  const hasInterfaces = data.interfaces && data.interfaces.length > 0;
  const hasLatency = data.latencyMeasurements && data.latencyMeasurements.length > 0;
  const hasConnections = data.connections !== null;
  const hasDevices = data.discoveredDevices && data.discoveredDevices.length > 0;

  if (!hasInterfaces && !hasLatency && !hasConnections && !hasDevices) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <Activity className="w-4 h-4" />
          Enhanced Network Monitoring
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="interfaces" className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="interfaces" className="text-xs">
              Interfaces ({data.interfaces?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="latency" className="text-xs">
              Latency ({data.latencyMeasurements?.length || 0})
            </TabsTrigger>
            <TabsTrigger value="connections" className="text-xs">
              Connections
            </TabsTrigger>
            <TabsTrigger value="devices" className="text-xs">
              Devices ({data.discoveredDevices?.length || 0})
            </TabsTrigger>
          </TabsList>
          
          <TabsContent value="interfaces" className="mt-4">
            {hasInterfaces ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {data.interfaces.map((iface, idx) => (
                  <InterfaceCard key={idx} iface={iface} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No interface data</div>
            )}
          </TabsContent>
          
          <TabsContent value="latency" className="mt-4">
            {hasLatency ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.latencyMeasurements.map((m, idx) => (
                  <LatencyCard key={idx} measurement={m} />
                ))}
              </div>
            ) : (
              <div className="text-center py-8 text-muted-foreground">No latency data</div>
            )}
          </TabsContent>
          
          <TabsContent value="connections" className="mt-4">
            {hasConnections ? (
              <ConnectionsCard connections={data.connections!} />
            ) : (
              <div className="text-center py-8 text-muted-foreground">No connection data</div>
            )}
          </TabsContent>
          
          <TabsContent value="devices" className="mt-4">
            <DeviceDiscoveryCard 
              devices={data.discoveredDevices || []} 
              lastScan={data.lastDiscoveryScanUtc} 
            />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
