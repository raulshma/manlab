/**
 * WakeOnLanTool Component
 * Send Wake-on-LAN magic packets to devices by MAC address.
 * Features:
 * - MAC address form with optional broadcast/port
 * - Save devices for one-click wake
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { Power, Plus, Trash2, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { notify } from "@/lib/network-notify";
import { sendWakeOnLan } from "@/api/networkApi";
import { generateId } from "@/lib/utils";

interface SavedDevice {
  id: string;
  name: string;
  macAddress: string;
  broadcastAddress?: string | null;
  port?: number | null;
}

const WOL_DEVICES_KEY = "manlab:network:wol-devices";
const WOL_MAC_KEY = "manlab:network:wol-mac";
const WOL_BROADCAST_KEY = "manlab:network:wol-broadcast";
const WOL_PORT_KEY = "manlab:network:wol-port";

function getStoredString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function getStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function loadSavedDevices(): SavedDevice[] {
  if (typeof window === "undefined") return [];
  const raw = localStorage.getItem(WOL_DEVICES_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as SavedDevice[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeMacAddress(input: string): string | null {
  const cleaned = input
    .replace(/[:\-.]/g, "")
    .replace(/\s+/g, "")
    .toUpperCase();

  if (!/^[0-9A-F]{12}$/.test(cleaned)) {
    return null;
  }

  return cleaned.match(/.{2}/g)?.join(":") ?? null;
}

export function WakeOnLanTool() {
  const [macAddress, setMacAddress] = useState(() => getStoredString(WOL_MAC_KEY, ""));
  const [broadcastAddress, setBroadcastAddress] = useState(() => getStoredString(WOL_BROADCAST_KEY, ""));
  const [port, setPort] = useState(() => getStoredNumber(WOL_PORT_KEY, 9));
  const [deviceName, setDeviceName] = useState("");
  const [savedDevices, setSavedDevices] = useState<SavedDevice[]>(() => loadSavedDevices());
  const [isSending, setIsSending] = useState(false);

  const normalizedMac = useMemo(() => normalizeMacAddress(macAddress), [macAddress]);
  const isValidMac = Boolean(normalizedMac);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(WOL_MAC_KEY, macAddress);
    localStorage.setItem(WOL_BROADCAST_KEY, broadcastAddress);
    localStorage.setItem(WOL_PORT_KEY, String(port));
  }, [macAddress, broadcastAddress, port]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.setItem(WOL_DEVICES_KEY, JSON.stringify(savedDevices));
  }, [savedDevices]);

  const handleSend = useCallback(
    async (device?: SavedDevice) => {
      const targetMac = normalizeMacAddress(device?.macAddress ?? macAddress);
      if (!targetMac) {
        notify.error("Enter a valid MAC address");
        return;
      }

      const targetBroadcast = device?.broadcastAddress ?? broadcastAddress;
      const targetPort = device?.port ?? port;

      setIsSending(true);
      try {
        const result = await sendWakeOnLan({
          macAddress: targetMac,
          broadcastAddress: targetBroadcast || null,
          port: Number.isFinite(targetPort) ? targetPort : null,
        });

        if (result.success) {
          notify.success(`Wake-on-LAN sent to ${result.macAddress}`);
        } else {
          notify.error(result.error ?? "Wake-on-LAN failed");
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Wake-on-LAN failed";
        notify.error(message);
      } finally {
        setIsSending(false);
      }
    },
    [macAddress, broadcastAddress, port]
  );

  const handleSave = useCallback(() => {
    const normalized = normalizeMacAddress(macAddress);
    if (!normalized) {
      notify.error("Enter a valid MAC address before saving");
      return;
    }

    const name = deviceName.trim() || `Device ${normalized}`;
    const newDevice: SavedDevice = {
      id: generateId(),
      name,
      macAddress: normalized,
      broadcastAddress: broadcastAddress || null,
      port: Number.isFinite(port) ? port : null,
    };

    setSavedDevices((prev) => [newDevice, ...prev]);
    setDeviceName("");
    notify.success(`Saved ${name}`);
  }, [macAddress, broadcastAddress, port, deviceName]);

  const handleRemove = useCallback((id: string) => {
    setSavedDevices((prev) => prev.filter((device) => device.id !== id));
  }, []);

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      <div>
        <p className="text-muted-foreground mt-1">
          Send magic packets to wake compatible devices on your network.
        </p>
      </div>

      <Card className="border-0 shadow-lg bg-card/60 backdrop-blur-xl ring-1 ring-border/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Power className="h-5 w-5 text-primary" />
            Send Magic Packet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="wol-mac">MAC Address</Label>
              <Input
                id="wol-mac"
                placeholder="00:11:22:33:44:55"
                value={macAddress}
                onChange={(e) => setMacAddress(e.target.value)}
              />
              <div className="text-xs text-muted-foreground">
                {isValidMac ? (
                  <span className="flex items-center gap-1">
                    <Badge variant="secondary" className="font-mono">
                      {normalizedMac}
                    </Badge>
                    <span>normalized</span>
                  </span>
                ) : (
                  <span>Use formats like 00:11:22:33:44:55 or 001122334455</span>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="wol-name">Device Label (optional)</Label>
              <Input
                id="wol-name"
                placeholder="NAS, Desktop, Lab Node"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="wol-broadcast">Broadcast Address (optional)</Label>
              <Input
                id="wol-broadcast"
                placeholder="255.255.255.255"
                value={broadcastAddress}
                onChange={(e) => setBroadcastAddress(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="wol-port">UDP Port</Label>
              <Input
                id="wol-port"
                type="number"
                min={1}
                max={65535}
                value={port}
                onChange={(e) => setPort(Number(e.target.value))}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <Button onClick={() => handleSend()} disabled={isSending || !isValidMac}>
              <Power className="h-4 w-4 mr-2" />
              {isSending ? "Sending..." : "Wake Now"}
            </Button>
            <Button variant="outline" onClick={handleSave} disabled={!isValidMac}>
              <Plus className="h-4 w-4 mr-2" />
              Save Device
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-primary" />
            Saved Devices
          </CardTitle>
        </CardHeader>
        <CardContent>
          {savedDevices.length === 0 ? (
            <div className="text-sm text-muted-foreground">
              No saved devices yet. Add a MAC address above to create quick actions.
            </div>
          ) : (
            <div className="space-y-3">
              {savedDevices.map((device) => (
                <div
                  key={device.id}
                  className="flex flex-col gap-3 rounded-lg border p-4 md:flex-row md:items-center md:justify-between"
                >
                  <div className="space-y-1">
                    <div className="font-medium">{device.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">
                      {device.macAddress}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Broadcast: {device.broadcastAddress || "255.255.255.255"} · Port: {device.port ?? 9}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => handleSend(device)}>
                      <Power className="h-4 w-4 mr-2" />
                      Wake
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleRemove(device.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
