import { useCallback, useEffect, useMemo, useState } from "react";
import { PauseCircle, PlayCircle, RefreshCw, StopCircle, Play } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useNetworkHub } from "@/hooks/useNetworkHub";
import {
  getPacketCaptureDevices,
  getPacketCaptureStatus,
  getRecentCapturedPackets,
  startPacketCapture,
  stopPacketCapture,
  type PacketCaptureDeviceInfo,
  type PacketCaptureRecord,
  type PacketCaptureStatus,
} from "@/api/networkApi";
import { cn } from "@/lib/utils";

const MAX_PACKETS = 500;

function formatTimestamp(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString();
}

export function PacketCaptureTool() {
  const { isConnected, subscribePacketCapture, unsubscribePacketCapture, subscribeToPacketCapture } = useNetworkHub();
  const [status, setStatus] = useState<PacketCaptureStatus | null>(null);
  const [devices, setDevices] = useState<PacketCaptureDeviceInfo[]>([]);
  const [packets, setPackets] = useState<PacketCaptureRecord[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [paused, setPaused] = useState(false);
  const [isStarting, setIsStarting] = useState(false);

  const refresh = useCallback(async () => {
    const [statusResult, deviceResult, packetResult] = await Promise.all([
      getPacketCaptureStatus(),
      getPacketCaptureDevices(),
      getRecentCapturedPackets(MAX_PACKETS),
    ]);

    setStatus(statusResult);
    setDevices(deviceResult);
    setPackets(packetResult);

    if (!selectedDevice && deviceResult.length > 0) {
      setSelectedDevice(deviceResult[0].name);
    }
  }, [selectedDevice]);

  useEffect(() => {
    refresh().catch(() => {
      // ignore
    });
  }, [refresh]);

  useEffect(() => {
    if (!isConnected) return;

    subscribePacketCapture().catch(() => {
      // ignore
    });

    const unsubscribe = subscribeToPacketCapture((packet) => {
      if (paused) return;
      setPackets((prev) => [...prev, packet].slice(-MAX_PACKETS));
    });

    return () => {
      unsubscribe();
      unsubscribePacketCapture().catch(() => {
        // ignore
      });
    };
  }, [isConnected, paused, subscribePacketCapture, subscribeToPacketCapture, unsubscribePacketCapture]);

  const handleStart = useCallback(async () => {
    setIsStarting(true);
    try {
      const next = await startPacketCapture({
        deviceName: selectedDevice,
        filter: filter.trim() || null,
      });
      setStatus(next);
    } finally {
      setIsStarting(false);
    }
  }, [filter, selectedDevice]);

  const handleStop = useCallback(async () => {
    const next = await stopPacketCapture();
    setStatus(next);
  }, []);

  const handleRefresh = useCallback(async () => {
    await refresh();
  }, [refresh]);

  const filteredPackets = useMemo(() => {
    if (!filter.trim()) return packets;
    const query = filter.toLowerCase();
    return packets.filter((packet) => {
      return (
        `${packet.source ?? ""} ${packet.destination ?? ""} ${packet.protocol ?? ""} ${packet.info ?? ""}`
          .toLowerCase()
          .includes(query)
      );
    });
  }, [packets, filter]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-lg font-semibold">Packet Capture</h3>
            <p className="text-sm text-muted-foreground">
              Capture live packets from a server interface with optional BPF filters.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleRefresh}>
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
            <Button variant="outline" size="sm" onClick={() => setPaused((prev) => !prev)}>
              {paused ? <PlayCircle className="h-4 w-4" /> : <PauseCircle className="h-4 w-4" />}
              {paused ? "Resume" : "Pause"}
            </Button>
            {status?.isCapturing ? (
              <Button variant="destructive" size="sm" onClick={handleStop}>
                <StopCircle className="h-4 w-4" />
                Stop
              </Button>
            ) : (
              <Button size="sm" onClick={handleStart} disabled={isStarting || devices.length === 0}>
                <Play className="h-4 w-4" />
                Start
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-3">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Status</div>
            <div className="flex items-center gap-2">
              <Badge variant={status?.isCapturing ? "default" : "outline"}>
                {status?.isCapturing ? "Capturing" : "Idle"}
              </Badge>
              {status?.error && <span className="text-xs text-destructive">{status.error}</span>}
            </div>
            <div className="text-xs text-muted-foreground">Device: {status?.deviceName ?? "—"}</div>
          </div>
          <div className="space-y-2">
            <Select value={selectedDevice ?? ""} onValueChange={(value) => setSelectedDevice(value)}>
              <SelectTrigger>
                <SelectValue placeholder="Select interface" />
              </SelectTrigger>
              <SelectContent>
                {devices.map((device) => (
                  <SelectItem key={device.name} value={device.name}>
                    {device.description ?? device.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              placeholder="BPF filter (tcp port 443)"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div className="text-xs text-muted-foreground">
              Buffered {status?.bufferedCount ?? packets.length} packets · Dropped {status?.droppedCount ?? 0}
            </div>
          </div>
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Capture</div>
            <div className={cn("text-sm", !status?.enabled && "text-destructive")}>
              {status?.enabled ? "Enabled" : "Disabled"}
            </div>
            <div className="text-xs text-muted-foreground">
              {status?.filter ? `Filter: ${status.filter}` : "No active filter"}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <div className="overflow-auto max-h-130">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur">
                <tr className="text-left">
                  <th className="px-3 py-2">Time</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Destination</th>
                  <th className="px-3 py-2">Proto</th>
                  <th className="px-3 py-2">Length</th>
                  <th className="px-3 py-2">Info</th>
                </tr>
              </thead>
              <tbody>
                {filteredPackets.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-muted-foreground">
                      No packets captured yet.
                    </td>
                  </tr>
                )}
                {filteredPackets.map((packet) => (
                  <tr key={packet.id} className="border-t">
                    <td className="px-3 py-2 whitespace-nowrap">{formatTimestamp(packet.capturedAtUtc)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {packet.source ?? "—"}
                      {packet.sourcePort ? `:${packet.sourcePort}` : ""}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {packet.destination ?? "—"}
                      {packet.destinationPort ? `:${packet.destinationPort}` : ""}
                    </td>
                    <td className="px-3 py-2">{packet.protocol ?? "—"}</td>
                    <td className="px-3 py-2">{packet.length}</td>
                    <td className="px-3 py-2">{packet.info ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
