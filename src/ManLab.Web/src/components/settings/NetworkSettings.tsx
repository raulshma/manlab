/**
 * NetworkSettings Component
 * Centralized settings panel for network scanning tools.
 * Allows users to configure default scan parameters, real-time updates,
 * and notification preferences.
 */

import { useState, useEffect, useCallback } from "react";
import {
  Network,
  RotateCcw,
  Save,
  Clock,
  Zap,
  RefreshCcw,
  Bell,
  Radio,
  Search,
  Server,
  Radar,
  Route,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { toast } from "sonner";
import {
  isRealtimeEnabled,
  isNotificationsEnabled,
  setRealtimeEnabled,
  setNotificationsEnabled,
  subscribeRealtimePreference,
  subscribeNotificationPreference,
} from "@/lib/network-preferences";

// ============================================================================
// Storage Keys (matching those used in individual tool components)
// ============================================================================

const STORAGE_KEYS = {
  // Ping Tool
  pingHost: "manlab:network:ping-host",
  pingTimeout: "manlab:network:ping-timeout",
  // Subnet Scanner
  lastSubnet: "manlab:network:last-subnet",
  subnetConcurrency: "manlab:network:subnet-concurrency",
  subnetTimeout: "manlab:network:subnet-timeout",
  // Port Scanner
  portHost: "manlab:network:port-host",
  portConcurrency: "manlab:network:port-concurrency",
  portTimeout: "manlab:network:port-timeout",
  // Traceroute Tool
  tracerouteHost: "manlab:network:traceroute-host",
  tracerouteMaxHops: "manlab:network:traceroute-max-hops",
  tracerouteTimeout: "manlab:network:traceroute-timeout",
  // Device Discovery
  discoveryDuration: "manlab:network:discovery-duration",
  // WiFi Scanner
  wifiAdapter: "manlab:network:wifi-adapter",
} as const;

// ============================================================================
// Types
// ============================================================================

interface NetworkPreferences {
  // Global preferences
  realtimeEnabled: boolean;
  notificationsEnabled: boolean;
  // Ping defaults
  pingTimeout: number;
  // Subnet defaults
  lastSubnet: string;
  subnetConcurrency: number;
  subnetTimeout: number;
  // Port scan defaults
  portConcurrency: number;
  portTimeout: number;
  // Traceroute defaults
  tracerouteMaxHops: number;
  tracerouteTimeout: number;
  // Discovery defaults
  discoveryDuration: number;
}

const DEFAULT_PREFERENCES: NetworkPreferences = {
  realtimeEnabled: true,
  notificationsEnabled: true,
  pingTimeout: 1000,
  lastSubnet: "",
  subnetConcurrency: 100,
  subnetTimeout: 500,
  portConcurrency: 50,
  portTimeout: 2000,
  tracerouteMaxHops: 30,
  tracerouteTimeout: 1000,
  discoveryDuration: 10,
};

// ============================================================================
// Utility Functions
// ============================================================================

function getStoredNumber(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = localStorage.getItem(key);
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getStoredString(key: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return localStorage.getItem(key) ?? fallback;
}

function loadPreferences(): NetworkPreferences {
  return {
    realtimeEnabled: isRealtimeEnabled(),
    notificationsEnabled: isNotificationsEnabled(),
    pingTimeout: getStoredNumber(STORAGE_KEYS.pingTimeout, DEFAULT_PREFERENCES.pingTimeout),
    lastSubnet: getStoredString(STORAGE_KEYS.lastSubnet, DEFAULT_PREFERENCES.lastSubnet),
    subnetConcurrency: getStoredNumber(STORAGE_KEYS.subnetConcurrency, DEFAULT_PREFERENCES.subnetConcurrency),
    subnetTimeout: getStoredNumber(STORAGE_KEYS.subnetTimeout, DEFAULT_PREFERENCES.subnetTimeout),
    portConcurrency: getStoredNumber(STORAGE_KEYS.portConcurrency, DEFAULT_PREFERENCES.portConcurrency),
    portTimeout: getStoredNumber(STORAGE_KEYS.portTimeout, DEFAULT_PREFERENCES.portTimeout),
    tracerouteMaxHops: getStoredNumber(STORAGE_KEYS.tracerouteMaxHops, DEFAULT_PREFERENCES.tracerouteMaxHops),
    tracerouteTimeout: getStoredNumber(STORAGE_KEYS.tracerouteTimeout, DEFAULT_PREFERENCES.tracerouteTimeout),
    discoveryDuration: getStoredNumber(STORAGE_KEYS.discoveryDuration, DEFAULT_PREFERENCES.discoveryDuration),
  };
}

function savePreferences(prefs: NetworkPreferences): void {
  if (typeof window === "undefined") return;
  
  // Save global preferences via the preference module (triggers events)
  setRealtimeEnabled(prefs.realtimeEnabled);
  setNotificationsEnabled(prefs.notificationsEnabled);
  
  // Save tool-specific preferences to localStorage
  localStorage.setItem(STORAGE_KEYS.pingTimeout, String(prefs.pingTimeout));
  localStorage.setItem(STORAGE_KEYS.lastSubnet, prefs.lastSubnet);
  localStorage.setItem(STORAGE_KEYS.subnetConcurrency, String(prefs.subnetConcurrency));
  localStorage.setItem(STORAGE_KEYS.subnetTimeout, String(prefs.subnetTimeout));
  localStorage.setItem(STORAGE_KEYS.portConcurrency, String(prefs.portConcurrency));
  localStorage.setItem(STORAGE_KEYS.portTimeout, String(prefs.portTimeout));
  localStorage.setItem(STORAGE_KEYS.tracerouteMaxHops, String(prefs.tracerouteMaxHops));
  localStorage.setItem(STORAGE_KEYS.tracerouteTimeout, String(prefs.tracerouteTimeout));
  localStorage.setItem(STORAGE_KEYS.discoveryDuration, String(prefs.discoveryDuration));
}

function clearAllNetworkPreferences(): void {
  if (typeof window === "undefined") return;
  
  // Clear all network-related localStorage keys
  Object.values(STORAGE_KEYS).forEach((key) => {
    localStorage.removeItem(key);
  });
  
  // Also clear the realtime and notification keys
  localStorage.removeItem("manlab:network:realtime");
  localStorage.removeItem("manlab:network:notifications");
}

// ============================================================================
// Component
// ============================================================================

export function NetworkSettings() {
  const [prefs, setPrefs] = useState<NetworkPreferences>(() => loadPreferences());
  const [hasChanges, setHasChanges] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Subscribe to real-time preference changes
  useEffect(() => {
    const unsubscribeRealtime = subscribeRealtimePreference((enabled) => {
      setPrefs((prev) => ({ ...prev, realtimeEnabled: enabled }));
    });
    const unsubscribeNotifications = subscribeNotificationPreference((enabled) => {
      setPrefs((prev) => ({ ...prev, notificationsEnabled: enabled }));
    });
    return () => {
      unsubscribeRealtime();
      unsubscribeNotifications();
    };
  }, []);

  // Track changes
  useEffect(() => {
    const current = loadPreferences();
    const hasChanged = JSON.stringify(prefs) !== JSON.stringify(current);
    setHasChanges(hasChanged);
  }, [prefs]);

  const updatePref = useCallback(<K extends keyof NetworkPreferences>(
    key: K,
    value: NetworkPreferences[K]
  ) => {
    setPrefs((prev) => ({ ...prev, [key]: value }));
    setHasChanges(true);
  }, []);

  const handleSave = useCallback(() => {
    setIsSaving(true);
    try {
      savePreferences(prefs);
      setHasChanges(false);
      toast.success("Network settings saved successfully");
    } catch (error) {
      console.error("Failed to save preferences:", error);
      toast.error("Failed to save settings");
    } finally {
      setIsSaving(false);
    }
  }, [prefs]);

  const handleReset = useCallback(() => {
    if (!confirm("Reset all network settings to defaults? This cannot be undone.")) {
      return;
    }
    
    clearAllNetworkPreferences();
    setPrefs(DEFAULT_PREFERENCES);
    
    // Apply the defaults to the preference system
    setRealtimeEnabled(DEFAULT_PREFERENCES.realtimeEnabled);
    setNotificationsEnabled(DEFAULT_PREFERENCES.notificationsEnabled);
    
    toast.success("Network settings reset to defaults");
  }, []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Network className="h-5 w-5" />
          Network Tools
        </CardTitle>
        <CardDescription>
          Configure default settings for network scanning and discovery tools.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Global Settings Section */}
        <div className="space-y-4">
          <h4 className="text-sm font-medium flex items-center gap-2">
            <RefreshCcw className="h-4 w-4" />
            Global Settings
          </h4>
          
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="realtime-switch" className="text-sm font-medium">
                  Real-time Updates
                </Label>
                <p className="text-xs text-muted-foreground">
                  Enable live scan progress via WebSocket
                </p>
              </div>
              <Switch
                id="realtime-switch"
                checked={prefs.realtimeEnabled}
                onCheckedChange={(checked) => updatePref("realtimeEnabled", checked)}
              />
            </div>
            
            <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
              <div className="space-y-0.5">
                <Label htmlFor="notifications-switch" className="text-sm font-medium flex items-center gap-1">
                  <Bell className="h-3.5 w-3.5" />
                  Notifications
                </Label>
                <p className="text-xs text-muted-foreground">
                  Show toast notifications for scan events
                </p>
              </div>
              <Switch
                id="notifications-switch"
                checked={prefs.notificationsEnabled}
                onCheckedChange={(checked) => updatePref("notificationsEnabled", checked)}
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Tool-Specific Settings */}
        <Accordion className="w-full" defaultValue={["ping", "subnet"]}>
          {/* Ping Settings */}
          <AccordionItem value="ping">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Radio className="h-4 w-4 text-primary" />
                <span>Ping Tool</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Default Timeout
                    </Label>
                    <span className="text-sm font-medium">{prefs.pingTimeout}ms</span>
                  </div>
                  <Slider
                    value={[prefs.pingTimeout]}
                    onValueChange={(v) => updatePref("pingTimeout", Array.isArray(v) ? v[0] : v)}
                    min={100}
                    max={5000}
                    step={100}
                  />
                  <p className="text-xs text-muted-foreground">
                    How long to wait for a ping response (100ms - 5000ms)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Subnet Scanner Settings */}
          <AccordionItem value="subnet">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Search className="h-4 w-4 text-primary" />
                <span>Subnet Scanner</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5">
                    <Network className="h-3.5 w-3.5" />
                    Default Subnet
                  </Label>
                  <Input
                    value={prefs.lastSubnet}
                    onChange={(e) => updatePref("lastSubnet", e.target.value)}
                    placeholder="e.g., 192.168.1.0/24"
                  />
                  <p className="text-xs text-muted-foreground">
                    Remember the last scanned subnet
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      Concurrency
                    </Label>
                    <span className="text-sm font-medium">{prefs.subnetConcurrency}</span>
                  </div>
                  <Slider
                    value={[prefs.subnetConcurrency]}
                    onValueChange={(v) => updatePref("subnetConcurrency", Array.isArray(v) ? v[0] : v)}
                    min={10}
                    max={500}
                    step={10}
                  />
                  <p className="text-xs text-muted-foreground">
                    Number of parallel ping requests (10 - 500)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Timeout
                    </Label>
                    <span className="text-sm font-medium">{prefs.subnetTimeout}ms</span>
                  </div>
                  <Slider
                    value={[prefs.subnetTimeout]}
                    onValueChange={(v) => updatePref("subnetTimeout", Array.isArray(v) ? v[0] : v)}
                    min={100}
                    max={2000}
                    step={100}
                  />
                  <p className="text-xs text-muted-foreground">
                    Per-host timeout for subnet scans (100ms - 2000ms)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Port Scanner Settings */}
          <AccordionItem value="ports">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Server className="h-4 w-4 text-primary" />
                <span>Port Scanner</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Zap className="h-3.5 w-3.5" />
                      Concurrency
                    </Label>
                    <span className="text-sm font-medium">{prefs.portConcurrency}</span>
                  </div>
                  <Slider
                    value={[prefs.portConcurrency]}
                    onValueChange={(v) => updatePref("portConcurrency", Array.isArray(v) ? v[0] : v)}
                    min={10}
                    max={200}
                    step={10}
                  />
                  <p className="text-xs text-muted-foreground">
                    Number of parallel port connections (10 - 200)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Timeout
                    </Label>
                    <span className="text-sm font-medium">{prefs.portTimeout}ms</span>
                  </div>
                  <Slider
                    value={[prefs.portTimeout]}
                    onValueChange={(v) => updatePref("portTimeout", Array.isArray(v) ? v[0] : v)}
                    min={500}
                    max={10000}
                    step={500}
                  />
                  <p className="text-xs text-muted-foreground">
                    Connection timeout per port (500ms - 10000ms)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Traceroute Settings */}
          <AccordionItem value="traceroute">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Route className="h-4 w-4 text-primary" />
                <span>Traceroute</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      Max Hops
                    </Label>
                    <span className="text-sm font-medium">{prefs.tracerouteMaxHops}</span>
                  </div>
                  <Slider
                    value={[prefs.tracerouteMaxHops]}
                    onValueChange={(v) => updatePref("tracerouteMaxHops", Array.isArray(v) ? v[0] : v)}
                    min={5}
                    max={64}
                    step={1}
                  />
                  <p className="text-xs text-muted-foreground">
                    Maximum number of network hops to trace (5 - 64)
                  </p>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Timeout
                    </Label>
                    <span className="text-sm font-medium">{prefs.tracerouteTimeout}ms</span>
                  </div>
                  <Slider
                    value={[prefs.tracerouteTimeout]}
                    onValueChange={(v) => updatePref("tracerouteTimeout", Array.isArray(v) ? v[0] : v)}
                    min={500}
                    max={5000}
                    step={100}
                  />
                  <p className="text-xs text-muted-foreground">
                    Timeout per hop (500ms - 5000ms)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* Device Discovery Settings */}
          <AccordionItem value="discovery">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Radar className="h-4 w-4 text-primary" />
                <span>Device Discovery</span>
              </div>
            </AccordionTrigger>
            <AccordionContent className="pt-4 pb-2">
              <div className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <Label className="flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5" />
                      Scan Duration
                    </Label>
                    <span className="text-sm font-medium">{prefs.discoveryDuration}s</span>
                  </div>
                  <Slider
                    value={[prefs.discoveryDuration]}
                    onValueChange={(v) => updatePref("discoveryDuration", Array.isArray(v) ? v[0] : v)}
                    min={1}
                    max={30}
                    step={1}
                  />
                  <p className="text-xs text-muted-foreground">
                    How long to listen for mDNS/UPnP devices (1s - 30s)
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </CardContent>
      <CardFooter className="flex justify-between gap-4 border-t pt-6">
        <Button
          variant="outline"
          onClick={handleReset}
          className="gap-1.5"
        >
          <RotateCcw className="h-4 w-4" />
          Reset to Defaults
        </Button>
        <Button
          onClick={handleSave}
          disabled={!hasChanges || isSaving}
          className="gap-1.5"
        >
          <Save className="h-4 w-4" />
          {isSaving ? "Saving..." : "Save Changes"}
        </Button>
      </CardFooter>
    </Card>
  );
}
